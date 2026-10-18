import ThreeView,{SelectiveEffectDesc,Pass,createFullscreenQuad,type ViewContext,type EffectConfig,type EffectUpdate,type SelectiveEffectConfig} from '@navaramap/three';
import {Pass as PostPass,MipmapBlurPass} from 'postprocessing';
import {Color,ShaderMaterial,Scene,Mesh,WebGLRenderTarget,HalfFloatType,RGBAFormat,type WebGLRenderer,type Camera,type BufferGeometry} from 'three';

type GlowOptions={strength:number;radius:number;levels:number;resolutionScale:number};
export type GlowConfig=SelectiveEffectConfig&{uniformGlow:GlowOptions};
const vertexShader=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const maskGLSL=`float buildingMask(vec2 uv){float bits=texture2D(tEffectIds,uv).r;return mod(floor(bits/exp2(float(slotBit))),2.0);}`;
/** Constant-amplitude lime halo from geometry only. This pass never reads a score, albedo or emissive buffer. */
export class UniformGlowEffectDesc extends SelectiveEffectDesc<GlowConfig,EffectUpdate>{
 static key='uniformGlow';
 static insertAfter=['mrt'];
 static insertBefore=['transparent'];
 static requiredBuffers=['selectiveEffect'] as const;
 constructor(view:ThreeView,ctx:ViewContext,config:EffectConfig){super(view,ctx,{...config,selectiveEffect:true,uniformGlow:{strength:.65,radius:.5,levels:4,resolutionScale:.75,...(config as Partial<GlowConfig>).uniformGlow}})}
 createPass(){return new Pass(new UniformGlowPass(this),null,{enabled:true})}
}
class UniformGlowPass extends PostPass{
 private desc:UniformGlowEffectDesc;
 private blur=new MipmapBlurPass();
 private source:WebGLRenderTarget;
 private fullscreenCamera:Camera;
 private geometry:BufferGeometry;
 private extractScene=new Scene();
 private compositeScene=new Scene();
 private extract:ShaderMaterial;
 private composite:ShaderMaterial;
 constructor(desc:UniformGlowEffectDesc){
  super('UniformSafetyGlow');this.desc=desc;
  const quad=createFullscreenQuad();this.fullscreenCamera=quad.camera;this.geometry=quad.geometry;
  this.source=new WebGLRenderTarget(1,1,{format:RGBAFormat,type:HalfFloatType,depthBuffer:false,stencilBuffer:false});
  this.extract=new ShaderMaterial({vertexShader,fragmentShader:`uniform sampler2D tEffectIds;uniform int slotBit;uniform vec3 glowColor;varying vec2 vUv;${maskGLSL}void main(){gl_FragColor=vec4(glowColor*buildingMask(vUv),1.0);}`,uniforms:{tEffectIds:{value:null},slotBit:{value:0},glowColor:{value:new Color('#c7e88a')}},depthTest:false,depthWrite:false});
  this.composite=new ShaderMaterial({vertexShader,fragmentShader:`uniform sampler2D tBase;uniform sampler2D tBloom;uniform sampler2D tEffectIds;uniform int slotBit;uniform float strength;varying vec2 vUv;${maskGLSL}void main(){vec4 base=texture2D(tBase,vUv);vec3 halo=texture2D(tBloom,vUv).rgb;float outside=1.0-buildingMask(vUv);gl_FragColor=vec4(base.rgb+halo*strength*outside,base.a);}`,uniforms:{tBase:{value:null},tBloom:{value:null},tEffectIds:{value:null},slotBit:{value:0},strength:{value:desc.layerConfig.uniformGlow.strength}},depthTest:false,depthWrite:false});
  this.extractScene.add(new Mesh(this.geometry,this.extract));this.compositeScene.add(new Mesh(this.geometry,this.composite));
  this.blur.levels=desc.layerConfig.uniformGlow.levels;this.blur.radius=desc.layerConfig.uniformGlow.radius;this.needsSwap=true;
 }
 initialize(renderer:WebGLRenderer,alpha:boolean){this.blur.initialize(renderer,alpha,HalfFloatType)}
 render(renderer:WebGLRenderer,input:WebGLRenderTarget,output:WebGLRenderTarget,deltaTime:number){
  const {resolutionScale,strength}=this.desc.layerConfig.uniformGlow;
  const w=Math.max(1,Math.floor(input.width*resolutionScale)),h=Math.max(1,Math.floor(input.height*resolutionScale));
  if(this.source.width!==w||this.source.height!==h){this.source.setSize(w,h);this.blur.setSize(w,h)}
  const mask=this.desc.getEffectIdsBuffer(),slot=this.desc.getEffectSlot();
  this.extract.uniforms.tEffectIds.value=mask;this.extract.uniforms.slotBit.value=slot;
  renderer.setRenderTarget(this.source);renderer.render(this.extractScene,this.fullscreenCamera);this.blur.render(renderer,this.source,null,deltaTime);
  this.composite.uniforms.tBase.value=input.texture;this.composite.uniforms.tBloom.value=this.blur.texture;this.composite.uniforms.tEffectIds.value=mask;this.composite.uniforms.slotBit.value=slot;this.composite.uniforms.strength.value=mask&&slot>=0?strength:0;
  renderer.setRenderTarget(this.renderToScreen?null:output);renderer.render(this.compositeScene,this.fullscreenCamera);
 }
 dispose(){this.blur.dispose();this.source.dispose();this.extract.dispose();this.composite.dispose();this.geometry.dispose();this.extractScene.clear();this.compositeScene.clear()}
}
