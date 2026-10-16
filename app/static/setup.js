let guided=null, guidedPoll=null, guidedWorkspace='', guidedBusy=false, guidedKind='', guidedSessions=[];
let guidedGetters=new Map();
const markdownEdits=new Map();
const terminalSetup=s=>!s||['complete','cancelled'].includes(s.state);
function guidedError(message='') { $('guided-error').hidden=!message;$('guided-error').textContent=message; }
function showGuided() { if(!$('setup-dialog').open)$('setup-dialog').showModal(); }
let guidedPending=null, progressConnectionError=false;
const progressStages=[['uploading','Sending CV'],['reading','Reading document'],['preparing','Preparing profile'],['validating','Checking draft']];
function setupDraft(kind) {
  if(guidedWorkspace!==workspace)return null;
  if(guidedPending?.kind===kind)return guidedPending;
  return guided?.kind===kind?guided:guidedSessions.find(s=>s?.kind===kind);
}
function elapsedText(start) {
  const seconds=Math.max(0,Math.floor((Date.now()-Date.parse(start))/1000));
  return Number.isFinite(seconds)?Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' elapsed':'Working…';
}
function elapsedLabel(start) {
  const label=node('span',elapsedText(start),'elapsed');label.dataset.startedAt=start;return label;
}
function updateElapsed() {
  document.querySelectorAll('[data-started-at]').forEach(el=>el.textContent=elapsedText(el.dataset.startedAt));
  document.querySelectorAll('[data-slow-start]').forEach(el=>el.hidden=Date.now()-Date.parse(el.dataset.slowStart)<60000);
}
setInterval(updateElapsed,1000);
function renderActivity() {
  const job=guidedPending||guided,active=job?.state==='processing',box=$('guided-activity');
  box.hidden=!active;box.replaceChildren();
  $('hide-setup').textContent=active?'Close and continue later':'Close';
  if(!active)return;
  const heading=node('div',undefined,'activity-heading');
  const spinner=node('span',undefined,'spinner');spinner.setAttribute('aria-hidden','true');
  heading.append(spinner,node('strong',job.message||'Preparing your profile…'));
  if(job.started_at)heading.append(elapsedLabel(job.started_at));
  box.append(heading);
  const steps=node('ol',undefined,'progress-steps');steps.setAttribute('aria-label','CV import stages');
  const index=progressStages.findIndex(([phase])=>phase===job.phase);
  for(const [i,[phase,name]] of progressStages.entries()) {
    const label=phase==='uploading'&&job.phase!=='uploading'?'CV received':name;
    const step=node('li',(index>i?'✓ ':index===i?'● ':'○ ')+label,index>i?'done':index===i?'current':'');
    if(index===i)step.setAttribute('aria-current','step');steps.append(step);
  }
  box.append(steps,node('p','You can close this window and return from the Candidate profile card. Your saved profile stays unchanged.','question-help'));
  if(job.started_at){const slow=node('p','This is taking longer than usual. You can close this window and return later.','slow-hint');slow.dataset.slowStart=job.started_at;box.append(slow);}
  if(progressConnectionError)box.append(node('p','Connection lost. Retrying the progress check…','slow-hint'));
  updateElapsed();
}
function updateSetupActivity() {renderSetup();renderActivity();}
function scheduleGuidedPoll() {
  clearTimeout(guidedPoll);
  if(guidedSessions.some(s=>s?.state==='processing')||guided?.state==='processing')guidedPoll=setTimeout(()=>loadGuided(),1200);
}
async function loadGuided(kind=guidedKind) {
  clearTimeout(guidedPoll);
  if(!workspace){guided=null;guidedSessions=[];updateSetupActivity();return true;}
  const requestedWorkspace=workspace;
  try {
    const result=await api('/api/setup?path='+encodeURIComponent(requestedWorkspace)+(kind?'&kind='+encodeURIComponent(kind):''));
    if(workspace!==requestedWorkspace)return false;
    const changed=guided?.revision!==result.session?.revision||guided?.phase!==result.session?.phase||guidedWorkspace!==workspace;
    const activityChanged=changed||progressConnectionError||JSON.stringify(guidedSessions)!==JSON.stringify(result.sessions||[]);
    guided=result.session;guidedSessions=result.sessions||[];guidedWorkspace=workspace;progressConnectionError=false;
    if(changed&&$('setup-dialog').open&&!guidedBusy)renderGuided();
    if(activityChanged)updateSetupActivity();scheduleGuidedPoll();return true;
  }catch(e){progressConnectionError=true;if($('setup-dialog').open)guidedError('Could not check progress. Your draft is kept. '+e.message);else error(e.message);renderActivity();scheduleGuidedPoll();return false;}
}
async function startGuided(kind) {
  if(guidedBusy||guidedPending)return;
  try {
    guidedKind=kind;if(!await loadGuided(kind))return;
    if(!terminalSetup(guided)){showGuided();renderGuided();return;}
    guidedBusy=true;
    guided=(await api('/api/setup/start',{workspace,kind})).session;guidedWorkspace=workspace;
    updateSetupActivity();renderGuided();showGuided();
  }catch(e){error(e.message);}finally{guidedBusy=false;renderSetup();}
}
function beginActivity(phase,message) {
  guidedPending={id:guided.id,kind:guided.kind,state:'processing',phase,message,started_at:new Date().toISOString()};
  updateSetupActivity();
}
async function guidedAction(action,extra={}) {
  if(guidedBusy)return;
  if(markdownEdits.has(guided.id)&&!['markdown','cancel','save'].includes(action)){guidedError('Save your profile edits before continuing.');return;}
  guidedBusy=true;guidedError();
  if(guided.kind==='profile'&&['source','answer','retry'].includes(action)&&!guidedPending)beginActivity(action==='source'?'uploading':'preparing',action==='source'?'Sending your CV…':'Preparing your profile…');
  updateSetupActivity();
  $('guided-form').inert=true;
  $('setup-dialog').querySelectorAll('button:not(#hide-setup)').forEach(b=>b.disabled=true);
  const target=guidedWorkspace;
  const draftId=guided.id,editor=$('profile-draft');if(editor)editor.readOnly=true;
  try {
    guided=(await api('/api/setup/'+action,{workspace:guidedWorkspace,id:guided.id,revision:guided.revision,...extra})).session;
    guidedPending=null;
    if(workspace!==target){await loadGuided();return;}
    if(['markdown','cancel','save'].includes(action))markdownEdits.delete(draftId);
    updateSetupActivity();renderGuided();scheduleGuidedPoll();
    if(guided.state==='complete') {
      $('setup-dialog').close();await recheckSetup();if(workspace)await refresh();
    }
  }catch(e){guidedError(e.message);}
  finally{guidedBusy=false;guidedPending=null;updateSetupActivity();if(editor)editor.readOnly=false;$('guided-form').inert=false;$('setup-dialog').querySelectorAll('button').forEach(b=>b.disabled=false);}
}

function selectControl(options,value,label) {
  const el=node('select');el.setAttribute('aria-label',label);
  for(const option of options){const o=node('option',Array.isArray(option)?option[1]:option);o.value=Array.isArray(option)?option[0]:option;el.append(o);}
  el.value=value;return el;
}
function inputControl(type,value,label) {const el=node('input');el.type=type;el.value=value??'';el.setAttribute('aria-label',label);return el;}
let profileTemplateHelp=null;
function profileFieldHelp() {
  const details=node('details',undefined,'profile-field-help'),body=node('div');
  details.append(node('summary','Field examples and formatting'),body);
  let loaded=false,busy=false;
  details.addEventListener('toggle',async()=>{
    if(!details.open||loaded||busy)return;
    busy=true;body.replaceChildren(node('p','Loading field examples…'));
    try {
      profileTemplateHelp=profileTemplateHelp||await api('/api/profile-template');
      body.replaceChildren(node('p','Examples are guidance, not your profile facts. Use Unknown when information is missing. Skills and languages use simple bullets; other lists use indented bullets. Keep dates at the precision stated in your CV.'));
      for(const section of profileTemplateHelp.sections) {
        const group=node('details');group.append(node('summary',section.label));
        for(const field of section.fields)group.append(node('strong',field.label+' · '+(field.type==='list'?'list':'text')),node('pre',field.markdown_example));
        body.append(group);
      }
      loaded=true;
    }catch(e){body.replaceChildren(node('p','Could not load examples. Close and reopen this help to retry. '+e.message));}
    finally{busy=false;}
  });
  return details;
}
function questionControl(q,wrap) {
  const unset=q.value==='__FILL_ME__',value=unset?null:q.value;
  let get,controls=node('div',undefined,'question-controls');
  if(q.type==='pay') {
    const rows=node('div');controls.append(rows);
    function addPay(row={}) {
      const box=node('div',undefined,'pay-row');
      const contract=selectControl([['b2b','B2B · before VAT'],['uop','UoP · gross']],row.contract||'b2b','Contract type');
      const minimum=inputControl('number',row.minimum,'Minimum amount');minimum.step='any';minimum.min='0.01';minimum.placeholder='Minimum amount';
      const currency=selectControl(['PLN','EUR','USD'],(row.currency||'PLN').toUpperCase(),'Currency');
      const period=selectControl([['month','Per month'],['year','Per year'],['hour','Per hour']],row.period||'month','Pay period');
      const remove=node('button','Remove','quiet');remove.type='button';remove.addEventListener('click',()=>box.remove());
      box.append(contract,minimum,currency,period,remove);box.readValue=()=>({contract:contract.value,minimum:minimum.value,currency:currency.value,period:period.value,basis:contract.value==='b2b'?'before_vat':'gross'});rows.append(box);
    }
    for(const row of Array.isArray(value)?value:[{}])addPay(row);
    const add=node('button','Add contract minimum','secondary');add.type='button';add.addEventListener('click',()=>addPay());controls.append(add);
    get=()=>[...rows.children].map(r=>r.readValue());
  } else if(q.type==='fx') {
    const date=inputControl('date',value?.date,'Rate date'),source=inputControl('url',value?.source,'Rate source URL'),base=selectControl(['EUR','PLN','USD'],(value?.base||'EUR').toUpperCase(),'Base currency');
    source.placeholder='Dated rate source URL';controls.append(node('label','Rate date'),date,node('label','Rate source URL'),source,node('label','Base currency'),base);
    const rates={};for(const c of ['EUR','PLN','USD']){rates[c]=inputControl('number',value?.rates?.[c]??value?.rates?.[c.toLowerCase()],c+' per unit of base currency');rates[c].step='any';rates[c].min='0.000001';controls.append(node('label',c+' per unit of base currency'),rates[c]);}
    get=()=>({date:date.value,source:source.value,base:base.value,rates:Object.fromEntries(Object.entries(rates).filter(([,input])=>input.value!=='').map(([c,input])=>[c,input.value]))});
  } else if(q.type==='multi') {
    const choices=[];
    for(const option of q.options){const label=node('label',undefined,'choice');const input=inputControl('checkbox','',q.label+' · '+option);input.checked=Array.isArray(value)&&value.includes(option);label.append(input,node('span',option));choices.push([option,input]);controls.append(label);}
    let custom=null;
    if(guided.kind==='profile'){custom=inputControl('text','','Other answer for '+q.label);custom.placeholder='Or provide another answer';controls.append(custom);}
    get=()=>[...choices.filter(([,el])=>el.checked).map(([v])=>v),...(custom?.value.trim()?[custom.value.trim()]:[])];
  } else if(q.type==='single') {
    const pick=selectControl([['','Choose or enter an answer'],...q.options],value||'',q.label);
    const custom=inputControl('text','','Other answer for '+q.label);custom.placeholder='Or provide another answer';controls.append(pick,custom);get=()=>custom.value.trim()||pick.value;
  } else {
    const el=q.type==='list'||q.type==='text'?node('textarea'):inputControl('number',value,q.label);
    el.setAttribute('aria-label',q.label);
    if(q.type==='list'){el.value=Array.isArray(value)?value.join('\n'):'';el.placeholder='One item per line';get=()=>el.value.split('\n').map(s=>s.trim()).filter(Boolean);}
    else if(q.type==='text'){el.value=value||'';get=()=>el.value.trim();}
    else{el.min='1';el.step=q.type==='decimal'?'any':'1';get=()=>el.value===''?null:q.type==='number'?Number(el.value):el.value;}
    controls.append(el);
  }
  if(q.nullable) {
    const label=q.type==='number'&&q.id==='discovery_budget'?'Automatic':q.type==='decimal'||q.type==='fx'||q.id==='candidate.city'?'Unknown / not specified':'No restriction';
    const mode=selectControl([['','Choose an option'],['value','Specify'],['none',label]],unset?'':value===null||value===undefined?'none':'value',q.label+' mode');
    const toggle=()=>{controls.hidden=mode.value!=='value';controls.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=controls.hidden);};mode.addEventListener('change',toggle);toggle();wrap.append(mode);
    const read=get;get=()=>{if(mode.value==='')throw new Error('Choose an option for '+q.label);return mode.value==='none'?null:read();};
  }
  wrap.append(controls);return get;
}
function renderGuided() {
  if(!guided)return;
  guidedError();guidedGetters=new Map();$('guided-fields').replaceChildren();
  $('guided-heading').textContent=guided.kind==='profile'?'Candidate profile':'Search preferences';
  $('guided-message').textContent=guided.state==='processing'?'We’re turning your CV into a profile you can review.':guided.message;
  renderActivity();
  $('guided-cancel').textContent=guided.state==='processing'?'Cancel import':'Discard draft';
  $('guided-form').hidden=!['source','questions'].includes(guided.state);
  $('guided-back').hidden=!(guided.kind==='config'&&guided.state==='questions'&&guided.stage>0);
  $('guided-save').hidden=guided.state!=='review';$('guided-save').textContent=guided.kind==='profile'?'Save profile':'Save preferences';
  $('guided-edit').hidden=guided.state!=='review'||guided.kind==='profile';$('guided-rebase').hidden=guided.state!=='review';
  $('guided-import').hidden=!(guided.kind==='profile'&&guided.state==='review');
  $('guided-retry').hidden=!guided.can_retry;$('guided-cancel').hidden=terminalSetup(guided);
  if(guided.state==='failed'&&guided.failure_detail){const details=node('details');details.append(node('summary','Technical details'),node('p',guided.failure_detail));$('guided-fields').append(details);$('guided-form').hidden=false;$('guided-next').hidden=true;}
  if(guided.state==='source'||guided.state==='failed'&&guided.kind==='profile'&&!guided.edited_markdown) {
    $('guided-form').hidden=false;
    const pick=selectControl([['','Choose an imported CV…'],...(guided.existing_sources||[]).map(s=>[s.id,s.name])],'','Imported CV');
    const upload=inputControl('file','','Choose another CV');upload.accept='.pdf,.md';upload.id='guided-cv';
    $('guided-fields').append(node('label','Reuse an imported CV'),pick,node('label','Or choose a PDF or Markdown CV (up to 10 MB)'),upload,node('p','CV text and professional answers are sent to your connected Codex for interpretation.','question-help'));
    guidedGetters.set('source',async()=>{const file=upload.files[0];if(!file){if(!pick.value)throw new Error('Choose a CV to continue');return {source_id:pick.value};}if(file.size>10*1024*1024)throw new Error('CV must be under 10 MB');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('Could not read the CV'));reader.readAsDataURL(file);});return {upload:{name:file.name,data}};});
    $('guided-next').textContent='Continue with CV';
  }else if(guided.state==='questions') {
    $('guided-next').textContent=guided.kind==='config'&&guided.stage===3?'Review preferences':'Continue';
    for(const q of guided.questions){const field=node('fieldset',undefined,'guided-question');field.append(node('legend',q.label+(q.required?' *':' (optional)')));if(q.help)field.append(node('p',q.help,'question-help'));guidedGetters.set(q.id,questionControl(q,field));$('guided-fields').append(field);}
  }else if(guided.state==='review'||guided.kind==='profile'&&guided.state==='failed'&&guided.edited_markdown) {
    if(guided.kind==='profile') {
      const editor=node('textarea',undefined,'guided-review');editor.id='profile-draft';editor.setAttribute('aria-label','Profile draft Markdown');editor.spellcheck=false;
      const draft=markdownEdits.get(guided.id);
      editor.value=draft?.revision===guided.revision?draft.text:guided.state==='failed'?guided.edited_markdown:guided.review;
      if(draft&&draft.revision!==guided.revision)markdownEdits.delete(guided.id);
      const updated=()=>{const changed=editor.value!==guided.review;$('guided-save').textContent='Save profile';if(changed)markdownEdits.set(guided.id,{revision:guided.revision,text:editor.value});else markdownEdits.delete(guided.id);};
      editor.addEventListener('input',updated);updated();
      $('guided-fields').append(node('label','Edit your profile draft directly'),editor,node('p','Save validates and applies your edits without AI. Keep section headings and field labels, plus IDs on repeated records. Skills and languages use simple bullets. Use Unknown to clear a fact.','question-help'));
      $('guided-fields').append(profileFieldHelp());
      $('guided-save').hidden=false;
    }else $('guided-fields').append(node('pre',guided.review,'guided-review'));
    $('guided-form').hidden=false;$('guided-next').hidden=true;
  }else if(guided.state==='processing') {
    $('guided-form').hidden=true;$('guided-next').hidden=true;
  }
  if(['source','questions'].includes(guided.state)||guided.state==='failed'&&!guided.edited_markdown)$('guided-next').hidden=false;
}
$('guided-form').addEventListener('submit',async e=>{e.preventDefault();if(guidedBusy||guidedPending)return;try{if(guidedGetters.has('source')){beginActivity('uploading','Sending your CV…');await guidedAction('source',await guidedGetters.get('source')());}else{const answers=Object.fromEntries([...guidedGetters].map(([id,get])=>[id,get()]));await guidedAction('answer',{answers});}}catch(e){guidedPending=null;updateSetupActivity();guidedError(e.message);}});
for(const action of ['retry','edit','rebase','back'])$('guided-'+action).addEventListener('click',()=>guidedAction(action));
$('guided-save').addEventListener('click',()=>{const editor=$('profile-draft');guidedAction('save',guided.kind==='profile'&&editor?{text:editor.value}:{});});
$('guided-import').addEventListener('click',()=>guidedAction('import_cv'));
window.addEventListener('beforeunload',e=>{if(markdownEdits.size){e.preventDefault();e.returnValue='';}});
$('guided-cancel').addEventListener('click',()=>{if(confirm('Discard this setup draft? Your active profile, preferences and tracked jobs will stay unchanged.'))guidedAction('cancel');});
$('hide-setup').addEventListener('click',()=>$('setup-dialog').close());
