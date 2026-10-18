import {defineConfig} from 'vite';
export default defineConfig({worker:{format:'es'},optimizeDeps:{exclude:['@navaramap/three','@navaramap/three-default-plugin','@navaramap/three-default-descs']},build:{target:'es2022',chunkSizeWarningLimit:2000}});
