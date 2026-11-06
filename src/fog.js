// Valley mist, replacing three.js's fog for every material that uses fog.
// - Distance is measured from the eye (not depth along the view axis), so turning the camera doesn't
//   push things in and out of the fog at the edges of wide screens.
// - The mist hugs the ground: it is thick up to MIST.x (a few meters above the hunter's ground) and
//   thins above it, so the castle on its crag, the hills and the mountain ring rise out of it together
//   instead of everything high up vanishing (or, before, the castle floating on a crag already lost in fog).
//   Along each line of sight the fog uses the mean density of that profile, so looking up through the
//   mist sees farther and looking down into the valley sees less. Being relative to the hunter's ground,
//   the mist around the hunter stays the same up on the crag as down in the valley.
// - Lights (unlit materials: windows, lanterns, glowing eyes, halos) reach MIST.w times farther, so at
//   night they still show through the dark, like the castle's windows across the valley.
// Import this before anything renders: the shader chunks are read when each material compiles.
import * as THREE from 'three';

// x: mist top (world y), y: how fast it thins above that (m), z: haze left high above it (0-1),
// w: how much farther lights reach (1 = like everything else).
// A plain object (not a Vector4) is shared by reference by every material's uniforms: three.js clones
// its own math types per material, but copies anything else as it is (UniformsUtils.cloneUniforms).
export const MIST = { x: 0, y: 0, z: 1, w: 1 };
for (const lib of Object.values(THREE.ShaderLib)) if (lib.uniforms.fogColor) lib.uniforms.hsMist = { value: MIST };
for (const id of ['basic', 'sprite', 'points']) THREE.ShaderLib[id].fragmentShader = '#define HS_LIGHT\n' + THREE.ShaderLib[id].fragmentShader;

const C = THREE.ShaderChunk;

C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying vec3 vHsFogRel;
#endif
`;

// the view rotation is orthonormal, so its transpose takes view space back to world axes
C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vHsFogRel = mvPosition.xyz * mat3( viewMatrix );
#endif
`;

C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	uniform vec4 hsMist;
	varying vec3 vHsFogRel;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	// mist density at height y (1 inside the mist) and its integral over y
	float hsMistRho( float y ) {
		float h = max( y - hsMist.x, 0.0 );
		return hsMist.z + ( 1.0 - hsMist.z ) * exp( - h / hsMist.y );
	}
	float hsMistInt( float y ) {
		float h = max( y - hsMist.x, 0.0 );
		return min( y, hsMist.x ) + hsMist.z * h + ( 1.0 - hsMist.z ) * hsMist.y * ( 1.0 - exp( - h / hsMist.y ) );
	}
#endif
`;

C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	float hsFogDist = length( vHsFogRel );
	if ( hsMist.y > 0.0 ) {
		float hsDy = vHsFogRel.y;
		hsFogDist *= abs( hsDy ) < 0.05 ? hsMistRho( cameraPosition.y )
			: ( hsMistInt( cameraPosition.y + hsDy ) - hsMistInt( cameraPosition.y ) ) / hsDy;
	}
	#ifdef HS_LIGHT
		hsFogDist /= max( hsMist.w, 1.0 );
	#endif
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * hsFogDist * hsFogDist );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, hsFogDist );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
