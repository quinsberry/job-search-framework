const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="jsf-token"]').content;
let workspace = '', data = null, filter = 'all', codexReady = false, pending = 0, poll = null;
const drafts = new Map(), queues = new Map(), selected = new Map(), expanded = new Set();
const statuses = ['ready','applied','screening','interviewing','offer','rejected','withdraw','closed'];
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
function error(message='') { $('error').hidden = !message; $('error').textContent = message; }
async function api(path, payload) {
  const response = await fetch(path, payload ? {method:'POST', headers:{'Content-Type':'application/json','X-JSF-Token':token}, body:JSON.stringify(payload)} : {});
  const value = await response.json();
  if (!response.ok) { const e = new Error(value.error || 'Request failed'); e.confirmation = value.confirmation_required; throw e; }
  return value;
}
function application(row) { return row.applications.find(a => a.application_id === selected.get(row.vacancy_id)) || (row.applications.length === 1 ? row.applications[0] : null); }
function currentValue(row, field) {
  if (field === 'applied') return row.applied_by_application?.[application(row)?.application_id] ?? row.applied;
  if (field === 'review') return row.review;
  if (field in row.values) return row.values[field];
  return application(row)?.[field === 'application_notes' ? 'notes' : field] || '';
}
function cell(row, field, label, options=null, multiline=false) {
  const wrap = node('div', undefined, 'cell'), key = row.vacancy_id + ':' + field;
  const input = node(options ? 'select' : multiline ? 'textarea' : 'input');
  input.setAttribute('aria-label', `${label} · ${row.values.company || row.vacancy_id}`);
  if (options) for (const option of options) { const o=node('option',option || (field==='status'?'Not recorded':'Unknown')); o.value=option; input.append(o); }
  if (field === 'applied') input.type = 'checkbox';
  else if (!options && !multiline) input.type = field === 'applied_at' ? 'date' : 'text';
  const value = drafts.has(key) ? drafts.get(key) : currentValue(row,field);
  if (field === 'applied') input.checked = value;
  else input.value = value ?? '';
  if (!options && field!=='applied') input.placeholder=field==='salary'?'Add asking pay':field==='notes'?'Add a note':'Unknown';
  if (row.applications.length > 1 && !application(row) && ['applied','status','salary','applied_at','next_interview','next_interview_at','interview_stages','application_notes'].includes(field)) {
    input.disabled=true; input.title='Choose an application in Details first';
  }
  const state=node('span','', 'save-status'); state.setAttribute('role','status');
  const retry=node('button','Retry','retry'); retry.type='button'; retry.hidden=true;
  async function save(value, rebase=false) {
    pending++; state.textContent='Saving…'; state.className='save-status'; retry.hidden=true;
    try {
      if (rebase) {
        const latest=await api('/api/workspace?path='+encodeURIComponent(workspace));
        const fresh=latest.rows.find(r=>r.vacancy_id===row.vacancy_id);
        if (!fresh) throw new Error('Vacancy changed identity. Refresh the table.');
        if (fresh.revision!==row.revision && !confirm('The saved row changed. Apply your edit to the latest version?')) throw new Error('Edit retained. Refresh to review the saved row.');
        Object.assign(row,fresh);
      }
      const payload={workspace,vacancy_id:row.vacancy_id,field,value,revision:row.revision,application_id:application(row)?.application_id || null};
      let response;
      try { response=await api('/api/edit',payload); }
      catch(e) { if (!e.confirmation || !confirm(e.message)) throw e; response=await api('/api/edit',{...payload,confirm:true}); }
      Object.assign(row,response.row);
      if (drafts.get(key)===value) drafts.delete(key);
      state.textContent='Saved'; updateCounts();
      // Reflect submission/status coupling without rebuilding focused input fields.
      const tr=wrap.closest('tr');
      if (tr && ['applied','status'].includes(field)) {
        tr.querySelectorAll('[data-row-applied]').forEach(el=>{el.checked=currentValue(row,'applied');});
        tr.querySelectorAll('[data-row-status]').forEach(el=>{el.value=currentValue(row,'status');});
      }
    } catch(e) { state.textContent='Failed: '+e.message; state.className='save-status failed'; retry.hidden=false; }
    finally { pending--; }
  }
  function enqueue(rebase=false) {
    const value=drafts.get(key);
    const previous=queues.get(row.vacancy_id)||Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>save(value,rebase));
    queues.set(row.vacancy_id,next);
    next.finally(()=>{if(queues.get(row.vacancy_id)===next)queues.delete(row.vacancy_id);});
  }
  input.addEventListener('change',()=>{drafts.set(key,field==='applied'?input.checked:input.value);enqueue();});
  retry.addEventListener('click',()=>enqueue(true));
  if (field==='applied') input.dataset.rowApplied='true';
  if (field==='status') input.dataset.rowStatus='true';
  if (drafts.has(key)) { state.textContent='Unsaved edit'; retry.hidden=false; }
  wrap.append(input,state,retry); return wrap;
}
function updateCounts() {
  if(!data)return;
  const applied=data.rows.filter(r=>r.applied).length;
  $('total').textContent=data.rows.length;
  $('summary').textContent=`${data.rows.length} tracked · ${applied} applied · ${data.rows.length-applied} with no recorded submission`;
}
function render() {
  $('rows').replaceChildren(); updateCounts();
  const query=$('query').value.toLowerCase();
  const visible=data.rows.filter(r=>(filter==='all'||r.applied===(filter==='applied'))&&`${r.values.company} ${r.values.title}`.toLowerCase().includes(query));
  $('empty').hidden=visible.length>0;
  $('empty').querySelector('h3').textContent=data.rows.length?'No matching opportunities.':'A fresh start.';
  $('empty').querySelector('p').textContent=data.rows.length?'Try another filter or search term.':'Complete your search config, then find your first jobs.';
  for(const row of visible){
    const tr=node('tr'); tr.dataset.id=row.vacancy_id;
    const add=content=>{const td=node('td');td.append(content);tr.append(td);return td;};
    const appliedCell=add(cell(row,'applied','Applied'));
    if(row.applications.length>1)appliedCell.append(node('small','Selected application'));
    add(cell(row,'company','Company'));
    const role=add(cell(row,'title','Role'));
    const link=node('a','Open vacancy ↗','role-link');link.href=row.values.url;link.target='_blank';link.rel='noopener noreferrer';role.append(link);
    role.append(node('span',row.fit.replaceAll('_',' '),'fit '+row.fit));
    add(cell(row,'work_type','Work arrangement',['','remote','hybrid','onsite']));
    add(cell(row,'advertised_compensation','Advertised pay',null,true));
    add(cell(row,'salary','Asking pay',null,true));
    add(cell(row,'status','Application status',['',...statuses]));
    const controls=add(cell(row,'notes','Vacancy notes'));
    const opened=expanded.has(row.vacancy_id);
    const toggle=node('button',opened?'Close details ↑':'Details ↓','details-toggle');toggle.type='button';toggle.setAttribute('aria-expanded',String(opened));controls.append(toggle);
    const detail=node('tr',undefined,'detail-row');detail.hidden=!opened;
    const td=node('td');td.colSpan=8;const grid=node('div',undefined,'detail-grid');td.append(grid);detail.append(td);
    const field=(name,label,options=null,multiline=false)=>{const group=node('div');group.append(node('label',label),cell(row,name,label,options,multiline));grid.append(group);};
    if(row.applications.length>1){
      const group=node('div'),pick=node('select');pick.setAttribute('aria-label','Choose application');
      const blank=node('option','Choose an application…');blank.value='';pick.append(blank);
      for(const a of row.applications){const o=node('option',`${a.position} · ${a.status} · ${a.application_id.slice(0,8)}`);o.value=a.application_id;pick.append(o);}
      pick.value=selected.get(row.vacancy_id)||'';pick.addEventListener('change',()=>{if(queues.has(row.vacancy_id)||[...drafts.keys()].some(k=>k.startsWith(row.vacancy_id+':'))){error('Save or retry this row before choosing another application.');pick.value=selected.get(row.vacancy_id)||'';return;}selected.set(row.vacancy_id,pick.value);render();});group.append(node('label','Choose a candidacy; the Applied checkbox edits that record.'),pick);grid.append(group);
    }
    field('url','Vacancy URL');field('location','Location');field('review','Review choice',['unreviewed','shortlisted','dismissed']);
    field('applied_at','Applied date (blank = unknown)');field('next_interview','Next interview');field('next_interview_at','Interview date/time (include timezone offset)');
    field('interview_stages','Interview stages (separate with ;)');field('application_notes','Application notes',null,true);field('description','Description correction',null,true);
    const evidence=node('details',undefined,'wide');evidence.append(node('summary','Source evidence & fit checks · read-only'));
    evidence.append(node('pre',JSON.stringify({availability:row.availability,corrected_fields:row.corrected_fields,source:row.original,checks:row.checks},null,2)));grid.append(evidence);
    toggle.addEventListener('click',()=>{detail.hidden=!detail.hidden;if(detail.hidden)expanded.delete(row.vacancy_id);else expanded.add(row.vacancy_id);toggle.textContent=detail.hidden?'Details ↓':'Close details ↑';toggle.setAttribute('aria-expanded',String(!detail.hidden));});
    $('rows').append(tr,detail);
  }
}
async function refresh(initial=false){
  if(!workspace)return;
  try{
    const incoming=await api('/api/workspace?path='+encodeURIComponent(workspace));
    if(initial||(!pending&&!drafts.size&&!document.activeElement?.closest('#rows'))){data=incoming;render();}
    $('board').hidden=false;
    const config=incoming.config;
    $('workspace-message').textContent=config.outcome==='ready'?'Ready to search. '+(config.profile_status==='partial'?'Your profile still has unknown or disputed facts. ':'')+'Changes save in this workspace.':'Search setup needs attention: '+[...(config.missing_fields||[]),...(config.errors||[])].join('; ')+'. Use jsf-profile to complete setup.';
    $('find').disabled=config.outcome!=='ready'||!codexReady||incoming.job?.state==='running';
    $('job').hidden=!incoming.job;$('job').textContent=incoming.job?.message||'';
    $('unlinked').hidden=!incoming.unlinked_applications.length;
    $('unlinked-rows').replaceChildren(...incoming.unlinked_applications.map(a=>node('div',`${a.company} · ${a.position} · ${a.status} · ${a.vacancy_link}`)));
    clearTimeout(poll);if(incoming.job?.state==='running')poll=setTimeout(()=>refresh(),2000);
  }catch(e){error(e.message);}
}
$('workspace-form').addEventListener('submit',async e=>{e.preventDefault();if(pending||drafts.size){error('Finish or retry unsaved edits before switching workspaces.');return;}error();clearTimeout(poll);$('board').hidden=true;data=null;workspace=$('workspace').value.trim();await refresh(true);});
$('find-form').addEventListener('submit',async e=>{e.preventDefault();error();try{await api('/api/find',{workspace,count:Number($('count').value)});await refresh();}catch(e){error(e.message);}});
$('refresh').addEventListener('click',()=>{if(pending||drafts.size){error('Your unsaved edits are still visible. Save or retry them before refreshing.');return;}refresh(true);});
$('adopt').addEventListener('click',async()=>{if(pending||drafts.size){error('Finish unsaved edits before importing applications.');return;}try{await api('/api/adopt-applications',{workspace});await refresh(true);}catch(e){error(e.message);}});
$('query').addEventListener('input',render);
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();}));
window.addEventListener('beforeunload',e=>{if(pending||drafts.size){e.preventDefault();e.returnValue='';}});
(async()=>{try{const session=await api('/api/session');codexReady=session.codex.ready;$('connection').textContent=session.codex.message;if(session.workspace){$('workspace').value=session.workspace;workspace=session.workspace;await refresh(true);}}catch(e){error(e.message);}})();
