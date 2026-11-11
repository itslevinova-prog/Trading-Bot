import {fileURLToPath} from 'node:url';
import {writeBuildManifest} from '../apps/server/dist/provenance/build.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=writeBuildManifest(root);
console.log(JSON.stringify({buildId:manifest.buildId,sourceFiles:manifest.sources.length,runtimeFiles:manifest.runtimeFiles.length}));
