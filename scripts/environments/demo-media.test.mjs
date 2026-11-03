import test from 'node:test';
import assert from 'node:assert/strict';
import {imageSource} from './demo-media.mjs';
test('only explicit demo image providers are copied',()=>{
 for(const url of ['https://images.unsplash.com/photo-test?w=1200','https://i.pravatar.cc/160?img=1','https://api.dicebear.com/9.x/shapes/svg?seed=Forma'])assert.equal(imageSource(url),true);
 for(const url of ['http://images.unsplash.com/x','https://images.unsplash.com.evil.test/x','https://password@images.unsplash.com/x','http://127.0.0.1/x','https://download.blender.org/video.mp4','https://staging.test/_media/x',null])assert.equal(imageSource(url),false);
});
