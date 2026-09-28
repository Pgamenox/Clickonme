const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('crear/index.html','utf8');
const photoSource=html.slice(html.indexOf('function validateProfilePhoto('),html.indexOf('let publishInFlight=false;'));
function photoContext(failAt){
 const checked=[],uploads=[];
 class Image {
   set src(value){checked.push(value);this.naturalWidth=900;this.naturalHeight=900;queueMicrotask(()=>value===failAt?this.onerror():this.onload());}
 }
 const context={Image,setTimeout,clearTimeout,crypto:{randomUUID:()=> 'unique-photo-id'},uploadProfileAsset:async(...args)=>{uploads.push(args);return 'https://storage.test/new-photo';}};
 vm.createContext(context);vm.runInContext(photoSource,context);
 return {context,checked,uploads};
}
test('new photo is decoded before and after uploading to an immutable object',async()=>{
 const {context,checked,uploads}=photoContext();
 assert.equal(await context.uploadProfilePhoto('data:image/jpeg;base64,valid','profile-andrea'),'https://storage.test/new-photo');
 assert.deepEqual(checked,['data:image/jpeg;base64,valid','https://storage.test/new-photo']);
 assert.equal(uploads[0][2],'photo-unique-photo-id');
});
test('corrupt new photo cannot upload or publish',async()=>{
 const {context,uploads}=photoContext('data:image/jpeg;base64,broken');
 await assert.rejects(context.uploadProfilePhoto('data:image/jpeg;base64,broken','folder'),/no se puede abrir/);
 assert.equal(uploads.length,0);
});
test('storage response that cannot decode prevents saving its URL',async()=>{
 const {context}=photoContext('https://storage.test/new-photo');
 await assert.rejects(context.uploadProfilePhoto('data:image/jpeg;base64,valid','folder'),/no se puede abrir/);
});
test('saving other fields preserves an existing photo without reuploading',async()=>{
 const {context,checked,uploads}=photoContext();
 assert.equal(await context.uploadProfilePhoto('https://storage.test/existing','folder'),'https://storage.test/existing');
 assert.equal(checked.length,0);assert.equal(uploads.length,0);
});
function editorQueryContext({admin=false,rows=[]}={}){
 const calls=[];
 const query={then(resolve){resolve({data:rows,error:null});}};
 for(const method of ['select','eq','in','not','order','limit'])query[method]=(...args)=>{calls.push([method,...args]);return query;};
 const context={currentUser:{id:'owner'},profileLoadedFor:null,createNewProfile:false,requestedProfileId:'16',currentUserIsAdmin:admin,
 supabaseClient:{from:()=>query},authStatus:{},window:{history:{replaceState(){}}},populateProfile:row=>calls.push(['populated',row.id])};
 vm.createContext(context);
 vm.runInContext(html.slice(html.indexOf('async function loadOwnProfile(){'),html.indexOf('document.getElementById("sessionBannerLogout")')),context);
 return {context,calls};
}
test('admin opens an existing team main card in the same editor',async()=>{
 const {context,calls}=editorQueryContext({admin:true,rows:[{id:16,account_role:'team',demo_profile:false}]});
 await context.loadOwnProfile();
 assert.ok(calls.some(x=>x[0]==='in'&&x[1]==='account_role'&&x[2].includes('team')));
 assert.ok(calls.some(x=>x[0]==='eq'&&x[1]==='demo_profile'&&x[2]===false));
 assert.ok(calls.some(x=>x[0]==='populated'&&x[1]===16));
 assert.ok(!calls.some(x=>x[0]==='eq'&&x[1]==='user_id'));
});
test('non-admin requested cards remain scoped to their owner',async()=>{
 const {context,calls}=editorQueryContext({rows:[{id:16}]});await context.loadOwnProfile();
 assert.ok(calls.some(x=>x[0]==='eq'&&x[1]==='user_id'&&x[2]==='owner'));
});

test('card summary uses the requested card and preserves non-admin ownership scope',async()=>{
 for(const admin of [false,true]){
  const calls=[],query={then(resolve){resolve({data:[],error:null});}};
  for(const method of ['select','eq','in','not','order','limit'])query[method]=(...args)=>{calls.push([method,...args]);return query;};
  const context={currentUser:{id:'owner'},requestedProfileId:'92',currentUserIsAdmin:admin,supabaseClient:{from:()=>query},document:{getElementById:()=>({style:{},replaceChildren(){}})}};
  vm.createContext(context);vm.runInContext(html.slice(html.indexOf('async function loadMyCards(){'),html.indexOf('async function loadOwnProfile(){')),context);
  await context.loadMyCards();
  assert.ok(calls.some(x=>x[0]==='eq'&&x[1]==='id'&&x[2]==='92'));
  assert.equal(calls.some(x=>x[0]==='eq'&&x[1]==='user_id'),!admin);
 }
});
