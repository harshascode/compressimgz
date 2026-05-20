import { optimise } from '@jsquash/oxipng';                                                                                                                                                  
 import initImageQuant, {                                                                                                                                                                     
   ImageQuantizer,                                                                                                                                                                            
   decode_png_to_rgba,                                                                                                                                                                        
   encode_palette_to_png,                                                                                                                                                                     
 } from 'libimagequant-wasm/wasm/libimagequant_wasm.js';                                                                                                                                      
 import imageQuantWasmUrl from './imagequant.wasm?url';                                                                                                                                       
                                                                                                                                                                                              
 type CompressRequest = {                                                                                                                                                                     
   type: 'compress';                                                                                                                                                                          
   requestId: number;                                                                                                                                                                         
   itemId: string;                                                                                                                                                                            
   buffer: ArrayBuffer;                                                                                                                                                                       
   quality: number;                                                                                                                                                                           
 };                                                                                                                                                                                           
                                                                                                                                                                                              
 type ReleaseRequest = {                                                                                                                                                                      
   type: 'release';                                                                                                                                                                           
   itemId: string;                                                                                                                                                                            
 };                                                                                                                                                                                           
                                                                                                                                                                                              
 type ClearRequest = {                                                                                                                                                                        
   type: 'clear';                                                                                                                                                                             
 };                                                                                                                                                                                           
                                                                                                                                                                                              
 type WorkerRequest = CompressRequest | ReleaseRequest | ClearRequest;                                                                                                                        
                                                                                                                                                                                              
 type WorkerResponse = {                                                                                                                                                                      
   type: 'compressed';                                                                                                                                                                        
   requestId: number;                                                                                                                                                                         
   itemId: string;                                                                                                                                                                            
   buffer: ArrayBuffer;                                                                                                                                                                       
 } | {                                                                                                                                                                                        
   type: 'error';                                                                                                                                                                             
   requestId: number;                                                                                                                                                                         
   itemId: string;                                                                                                                                                                            
   message: string;                                                                                                                                                                           
 };                                                                                                                                                                                           
                                                                                                                                                                                              
 type DecodedPng = {                                                                                                                                                                          
   data: Uint8ClampedArray;                                                                                                                                                                   
   width: number;                                                                                                                                                                             
   height: number;                                                                                                                                                                            
 };                                                                                                                                                                                           
                                                                                                                                                                                              
 type CachedPng = {                                                                                                                                                                           
   decoded?: DecodedPng;                                                                                                                                                                      
   lossless?: ArrayBuffer;                                                                                                                                                                    
 };                                                                                                                                                                                           
                                                                                                                                                                                              
 const imageCache = new Map<string, CachedPng>();                                                                                                                                             
 const workerScope: Worker = self as unknown as Worker;                                                                                                                                       
 let imageQuantReady: Promise<unknown> | undefined;                                                                                                                                           
                                                                                                                                                                                              
 function initQuantizer(): Promise<unknown> {                                                                                                                                                 
   imageQuantReady ??= initImageQuant(imageQuantWasmUrl);                                                                                                                                     
   return imageQuantReady;                                                                                                                                                                    
 }                                                                                                                                                                                            
                                                                                                                                                                                              
 function clamp(value: number, min: number, max: number): number {                                                                                                                            
   return Math.min(max, Math.max(min, value));                                                                                                                                                
 }                                                                                                                                                                                            
                                                                                                                                                                                              
 function exactArrayBuffer(bytes: Uint8Array | Uint8ClampedArray | ArrayBuffer): ArrayBuffer {                                                                                                
   if (bytes instanceof ArrayBuffer) return bytes.slice(0);                                                                                                                                   
   const copy = new Uint8Array(bytes.byteLength);                                                                                                                                        
   copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));                                                                                                           
   return copy.buffer;                                                                                                        
 }                                                                                                                                                                                            
                                                                                                                                                                                              
 function byteLength(buffer: ArrayBuffer): number {                                                                                                                                           
   return buffer.byteLength;                                                                                                                                                                  
 }                                                                                                                                                                                            
                                                                                                                                                                                              
 async function optimisePng(buffer: ArrayBuffer): Promise<ArrayBuffer> {                                                                                                                      
   try {                                                                                                                                                                                      
     return await optimise(buffer, {                                                                                                                                                          
       level: 6,                                                                                                                                                                              
       interlace: false,                                                                                                                                                                      
       optimiseAlpha: true,                                                                                                                                                                   
     });                                                                                                                                                                                      
   } catch {                                                                                                                                                                                  
     return buffer;                                                                                                                                                                           
   }                                                                                                                                                                                          
 }                                                                                                                                                                                            
                                                                                                                                                                                              
 function getQuantizationOptions(quality: number): {                                                                                                                                          
   minQuality: number;                                                                                                                                                                        
   targetQuality: number;                                                                                                                                                                     
   maxColors: number;                                                                                                                                                                         
   speed: number;                                                                                                                                                                             
   dithering: number;                                                                                                                                                                         
 } {                                                                                                                                                                                          
   const targetQuality = clamp(Math.round(quality), 10, 100);                                                                                                                                 
   const minQuality = clamp(targetQuality - (targetQuality >= 90 ? 6 : 12), 0, 100);                                                                                                          
                                                                                                                                                                                              
   // Keep high-quality files near full palette, but reduce colors harder as the                                                                                                              
   // slider moves down. libimagequant can still use fewer colors when possible.                                                                                                              
   const normalized = targetQuality / 100;                                                                                                                                                    
   const maxColors = clamp(Math.round(2 + 254 * normalized * normalized), 2, 256);                                                                                                            
                                                                                                                                                                                              
   return {                                                                                                                                                                                   
     minQuality,                                                                                                                                                                              
     targetQuality,                                                                                                                                                                           
     maxColors,                                                                                                                                                                               
     // libimagequant speed: 1 = best quality/slowest, 10 = fastest.                                                                                                                          
     // Stay close to best quality while avoiding terrible latency on lower settings.                                                                                                         
     speed: targetQuality >= 85 ? 1 : targetQuality >= 70 ? 2 : targetQuality >= 50 ? 3 : 4,                                                                                                  
     dithering: targetQuality >= 85 ? 0.9 : targetQuality >= 65 ? 0.75 : targetQuality >= 45 ? 0.55 : 0.35,                                                                                   
   };                                                                                                                                                                                         
 }                                                                                                                                                                                            
                                                                                                                                                                                              
 async function decodePng(buffer: ArrayBuffer): Promise<DecodedPng> {                                                                                                                         
   await initQuantizer();                                                                                                                                                                     
   const decoded = decode_png_to_rgba(new Uint8Array(buffer));                                                                                                                                
   const data = decoded[0] as Uint8ClampedArray;                                                                                                                                              
   const width = decoded[1] as number;                                                                                                                                                        
   const height = decoded[2] as number;                                                                                                                                                       
   return { data, width, height };                                                                                                                                                            
 }                                                                                                                                                                                            
                                                                                                                                                                                              
 async function quantizePng(decoded: DecodedPng, quality: number): Promise<ArrayBuffer> {                                                                                                     
   await initQuantizer();                                                                                                                                                                     
   const options = getQuantizationOptions(quality);                                                                                                                                           
   const quantizer = new ImageQuantizer();                                                                                                                                                    
                                                                                                                                                                                              
   try {                                                                                                                                                                                      
     quantizer.setSpeed(options.speed);                                                                                                                                                       
     quantizer.setQuality(options.minQuality, options.targetQuality);                                                                                                                         
     quantizer.setMaxColors(options.maxColors);                                                                                                                                               
                                                                                                                                                                                              
     const result = quantizer.quantizeImage(decoded.data, decoded.width, decoded.height);                                                                                                     
     try {                                                                                                                                                                                    
       result.setDithering(options.dithering);                                                                                                                                                
       const palette = result.getPalette();                                                                                                                                                   
       const paletteIndices = result.getPaletteIndices(decoded.data, decoded.width, decoded.height);                                                                                          
       const pngBytes = encode_palette_to_png(paletteIndices, palette, decoded.width, decoded.height);                                                                                        
       return exactArrayBuffer(pngBytes);                                                                                                                                                     
     } finally {                                                                                                                                                                              
       result.free();                                                                                                                                                                         
     }                                                                                                                                                                                        
   } finally {                                                                                                                                                                                
     quantizer.free();                                                                                                                                                                        
   }                                                                                                                                                                                          
 }                                                                                                                                                                                            
                                                                                                                                                                                              
 async function getLosslessOptimized(itemId: string, buffer: ArrayBuffer): Promise<ArrayBuffer> {                                                                                             
   const cache = imageCache.get(itemId) ?? {};                                                                                                                                                
   if (!cache.lossless) {                                                                                                                                                                     
     cache.lossless = await optimisePng(buffer);                                                                                                                                              
     imageCache.set(itemId, cache);                                                                                                                                                           
   }                                                                                                                                                                                          
   return cache.lossless;                                                                                                                                                                     
 }                                                                                                                                                                                            
                                                                                                                                                                                              
 async function getDecoded(itemId: string, buffer: ArrayBuffer): Promise<DecodedPng> {                                                                                                        
   const cache = imageCache.get(itemId) ?? {};                                                                                                                                                
   if (!cache.decoded) {                                                                                                                                                                      
     cache.decoded = await decodePng(buffer);                                                                                                                                                 
     imageCache.set(itemId, cache);                                                                                                                                                           
   }                                                                                                                                                                                          
   return cache.decoded;                                                                                                                                                                      
 }                                                                                                                                                                                            
                                                                                                                                                                                              
 async function compress({ requestId, itemId, buffer, quality }: CompressRequest): Promise<void> {                                                                                            
   try {                                                                                                                                                                                      
     const lossless = await getLosslessOptimized(itemId, buffer);                                                                                                                             
     let best = lossless;                                                                                                                                                                     
                                                                                                                                                                                              
     // Quality 100 means truly lossless PNG optimization. Lower settings use                                                                                                                 
     // libimagequant first, then oxipng squeezes the indexed PNG further.                                                                                                                    
     if (quality < 100) {                                                                                                                                                                     
       const decoded = await getDecoded(itemId, buffer);                                                                                                                                      
       const quantized = await quantizePng(decoded, quality);                                                                                                                                 
       const quantizedOptimized = await optimisePng(quantized);                                                                                                                               
       if (byteLength(quantizedOptimized) < byteLength(best)) best = quantizedOptimized;                                                                                                      
     }                                                                                                                                                                                        
                                                                                                                                                                                              
     const output = exactArrayBuffer(best);                                                                                                                                                   
     const response: WorkerResponse = {                                                                                                                                                       
       type: 'compressed',                                                                                                                                                                    
       requestId,                                                                                                                                                                             
       itemId,                                                                                                                                                                                
       buffer: output,                                                                                                                                                                        
     };                                                                                                                                                                                       
     workerScope.postMessage(response, [output]);                                                                                                                                             
   } catch (error) {                                                                                                                                                                          
     const response: WorkerResponse = {                                                                                                                                                       
       type: 'error',                                                                                                                                                                         
       requestId,                                                                                                                                                                             
       itemId,                                                                                                                                                                                
       message: error instanceof Error ? error.message : 'Could not compress this PNG file.',                                                                                                 
     };                                                                                                                                                                                       
     workerScope.postMessage(response);                                                                                                                                                       
   }                                                                                                                                                                                          
 }                                                                                                                                                                                            
                                                                                                                                                                                              
 workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {                                                                                                            
   const message = event.data;                                                                                                                                                                
                                                                                                                                                                                              
   if (message.type === 'compress') {                                                                                                                                                         
     void compress(message);                                                                                                                                                                  
   } else if (message.type === 'release') {                                                                                                                                                   
     imageCache.delete(message.itemId);                                                                                                                                                       
   } else {                                                                                                                                                                                   
     imageCache.clear();                                                                                                                                                                      
   }                                                                                                                                                                                          
 });