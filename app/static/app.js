const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="jsf-token"]').content;
let workspace = '', data = null, filter = 'all', setup = null, setupChecking = false, trackerError = '', countEdited = false, pending = 0, poll = null;
const drafts = new Map(), queues = new Map(), selected = new Map(), expanded = new Set();
const selectedVacancies = new Set();
let removal = null, removalBusy = false;
const statuses = ['ready','applied','screening','interviewing','offer','rejected','withdraw','closed'];
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
function error(message='') { $('error').hidden = !message; $('error').textContent = message; }
async function api(path, payload) {
  const response = await fetch(path, payload ? {method:'POST', headers:{'Content-Type':'application/json','X-JSF-Token':token}, body:JSON.stringify(payload)} : {});
  const value = await response.json();
  if (!response.ok) { const e = new Error(response.status===404 ? 'The running app server does not support this action. Restart the app server and refresh this page.' : value.error || 'Request failed'); e.confirmation = value.confirmation_required; throw e; }
  return value;
}
function renderSetup() {
  const labels={ready:'✓ Ready',warning:'! Usable with warnings',blocked:'✕ Needs attention',pending:'○ Not checked'};
  $('setup-checks').replaceChildren();
  for(const check of setup?.checks || []) {
    const item=node('li',undefined,'setup-item '+check.state);
    const heading=node('div',undefined,'setup-item-heading');
    heading.append(node('strong',check.label),node('span',labels[check.state],'setup-state'));
    item.append(heading);
    if(check.key==='profile')item.append(node('p','Your experience and skills, used to assess job fit.','setup-purpose'));
    if(check.key==='config')item.append(node('p','Choose the roles, pay and working arrangements you want.','setup-purpose'));
    item.append(node('p',check.message));
    if(check.details?.length){const details=node('details'),list=node('ul');details.append(node('summary','View details ('+check.details.length+')'));list.append(...check.details.map(text=>node('li',text)));details.append(list);item.append(details);}
    if(check.diagnostics?.length){const details=node('details'),list=node('ul');details.append(node('summary','Technical details'));list.append(...check.diagnostics.map(text=>node('li',text)));details.append(list);item.append(details);}
    if(['profile','config'].includes(check.key)&&setup?.checks.find(c=>c.key==='workspace')?.state==='ready') {
      const draft=typeof setupDraft==='function'?setupDraft(check.key):null;
      let actionLabel=check.key==='profile'?(['ready','warning'].includes(check.state)?'Edit profile':'Set up profile'):(check.state==='ready'?'Edit preferences':'Set preferences');
      if(draft&&!terminalSetup(draft)) {
        const active=draft.state==='processing',waiting=draft.state==='questions',review=draft.state==='review';
        const activity=node('div',undefined,'card-activity '+(active?'working':draft.state==='failed'?'failed':'waiting'));
        const status=node('div',undefined,'activity-heading');status.setAttribute('role','status');
        if(active){const spinner=node('span',undefined,'spinner');spinner.setAttribute('aria-hidden','true');status.append(spinner);}
        const label=active?(draft.message||'Preparing your profile…'):review?'Draft ready to review':waiting?(check.key==='profile'?'A few questions need your answers':'Your preferences draft is unfinished'):draft.state==='failed'?'Import needs attention':'CV import is unfinished';
        status.append(node('strong',label));activity.append(status);
        if(active&&draft.started_at){activity.append(elapsedLabel(draft.started_at));const slow=node('p','Taking longer than usual. You can return later.','slow-hint');slow.dataset.slowStart=draft.started_at;activity.append(slow);}
        if(active&&check.key==='profile'&&['ready','warning'].includes(check.state))activity.append(node('p','Your saved profile is still ready to use.'));
        item.append(activity);
        actionLabel=active?'View progress':review?(check.key==='profile'?'Review profile':'Review preferences'):waiting?(check.key==='profile'?'Answer questions':'Continue preferences'):draft.state==='failed'?'View import issue':'Continue profile';
      }
      const action=node('button',actionLabel,'secondary');action.type='button';
      action.disabled=typeof guidedBusy!=='undefined'&&(guidedBusy||!!guidedPending);
      action.addEventListener('click',()=>startGuided(check.key));item.append(action);
    }
    $('setup-checks').append(item);
  }
  const scriptsOnly=Number($('ai-calls').value)===0;
  const blockers=(setup?.checks || []).filter(c=>['blocked','pending'].includes(c.state)&&!(scriptsOnly&&c.key==='codex'));
  const running=data?.job?.state==='running';
  let reason=setupChecking?'Checking setup…':!setup?'Setup could not be checked. Recheck setup to retry.':blockers.length?'Before searching: '+blockers.map(c=>c.label+' — '+c.message).join(' · '):'Ready to search. The target counts new matching jobs; rejected and uncertain listings do not count.';
  if(trackerError)reason='Could not load tracked jobs: '+trackerError;
  else if(running)reason='A search is already running. You can search again when it finishes.';
  if(scriptsOnly&&setup&&!setupChecking&&!running&&!trackerError&&!blockers.length)reason='Scripts and saved facts only. Unresolved listings stop the run without using AI.';
  $('search-reason').textContent=reason;
  $('find').disabled=setupChecking||!setup||!!blockers.length||!!trackerError||running||removalBusy;
  $('find').title=reason;$('find').setAttribute('aria-describedby','search-reason');
  const connected=setup?.checks.find(c=>c.key==='workspace')?.state==='ready';
  document.querySelector('.local').textContent=connected?'✓ Workspace opened':'○ No workspace opened';
  const codex=setup?.checks.find(c=>c.key==='codex');
  if(codex)$('connection').textContent=codex.message;
}
async function recheckSetup() {
  setupChecking=true;$('recheck').disabled=true;renderSetup();
  try { setup=await api('/api/readiness?path='+encodeURIComponent(workspace)); }
  catch(e) { setup=null;error(e.message); }
  finally { setupChecking=false;$('recheck').disabled=false;renderSetup();if(typeof loadGuided==='function')await loadGuided(); }
}
function application(row) { return row.applications.find(a => a.application_id === selected.get(row.vacancy_id)) || (row.applications.length === 1 ? row.applications[0] : null); }
function currentValue(row, field) {
  if (field === 'review') return row.review;
  if (field in row.values) return row.values[field];
  return application(row)?.[field === 'application_notes' ? 'notes' : field] || '';
}
function cell(row, field, label, options=null, multiline=false) {
  const wrap = node('div', undefined, 'cell'), key = row.vacancy_id + ':' + field;
  const input = node(options ? 'select' : multiline ? 'textarea' : 'input');
  input.setAttribute('aria-label', `${label} · ${row.values.company || row.vacancy_id}`);
  if (options) for (const option of options) { const o=node('option',option || (field==='status'?'Not recorded':'Unknown')); o.value=option; input.append(o); }
  if (!options && !multiline) input.type = field === 'applied_at' ? 'date' : 'text';
  const value = drafts.has(key) ? drafts.get(key) : currentValue(row,field);
  input.value = value ?? '';
  if (!options) input.placeholder=field==='salary'?'Add asking pay':field==='notes'?'Add a note':'Unknown';
  if (row.applications.length > 1 && !application(row) && ['status','salary','applied_at','next_interview','next_interview_at','interview_stages','application_notes'].includes(field)) {
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
      if (tr && field==='status') {
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
  input.addEventListener('change',()=>{drafts.set(key,input.value);enqueue();});
  retry.addEventListener('click',()=>enqueue(true));
  if (field==='status') input.dataset.rowStatus='true';
  if (drafts.has(key)) { state.textContent='Unsaved edit'; retry.hidden=false; }
  wrap.append(input,state,retry); return wrap;
}
function tableNotice(message='', failed=false) {
  $('table-notice').hidden=!message;$('table-notice').textContent=message;$('table-notice').classList.toggle('failed',failed);
}
function visibleRows() {
  const query=$('query').value.toLowerCase();
  return ($('show-inspected').checked?data.rows:mainRows()).filter(r=>(filter==='all'||r.applied===(filter==='applied'))&&`${r.values.company} ${r.values.title}`.toLowerCase().includes(query));
}
function renderSelection() {
  if(!data)return;
  const visible=visibleRows(), ids=new Set(visible.map(r=>r.vacancy_id));
  for(const id of selectedVacancies)if(!ids.has(id))selectedVacancies.delete(id);
  const count=selectedVacancies.size, running=data.job?.state==='running';
  $('selection-actions').hidden=!count;$('selection-count').textContent=`${count} selected`;
  $('remove-selected').disabled=removalBusy||running;
  $('selection-reason').textContent=running?'Removal is available after the search finishes.':'';
  $('clear-selection').disabled=removalBusy;
  $('select-visible').disabled=removalBusy||!visible.length;
  $('select-visible').checked=!!visible.length&&count===visible.length;
  $('select-visible').indeterminate=count>0&&count<visible.length;
  document.querySelectorAll('[data-vacancy-selection]').forEach(input=>{input.checked=selectedVacancies.has(input.dataset.vacancySelection);input.disabled=removalBusy;});
  document.querySelectorAll('.remove-vacancy').forEach(button=>{button.disabled=removalBusy||running;button.title=running?'Removal is available after the search finishes.':'';});
}
function openRemoval(ids) {
  if(pending||drafts.size){tableNotice('Finish or retry unsaved edits before removing vacancies.',true);return;}
  if(data.job?.state==='running'){tableNotice('Removal is available after the search finishes.',true);return;}
  const rows=ids.map(id=>data.rows.find(r=>r.vacancy_id===id)).filter(Boolean);
  if(!rows.length){removal=null;if($('removal-dialog').open)$('removal-dialog').close();tableNotice('The selected vacancies are no longer in the table. Nothing was removed.');return false;}
  removal={workspace,rows:rows.map(r=>({vacancy_id:r.vacancy_id,revision:r.revision}))};
  $('removal-heading').textContent=`Remove ${rows.length} ${rows.length===1?'vacancy':'vacancies'}?`;
  $('removal-list').replaceChildren(...rows.map(r=>node('li',`${r.values.company} — ${r.values.title}`)));
  $('removal-error').hidden=true;$('removal-progress').hidden=true;$('refresh-removal').hidden=true;
  $('confirm-removal').textContent=`Remove ${rows.length===1?'vacancy':rows.length+' vacancies'}`;
  if(!$('removal-dialog').open)$('removal-dialog').showModal();
  $('cancel-removal').focus();return true;
}
function cancelRemoval() {
  if(removalBusy)return;
  removal=null;$('removal-dialog').close();tableNotice('Removal cancelled. No vacancies were removed.');
}
async function confirmRemoval(e) {
  e.preventDefault();if(removalBusy||!removal)return;
  const request=removal;
  removalBusy=true;pending++;renderSelection();renderSetup();
  $('confirm-removal').disabled=true;$('confirm-removal').textContent='Removing…';
  $('cancel-removal').disabled=true;$('refresh-removal').disabled=true;
  $('removal-error').hidden=true;$('removal-progress').hidden=false;$('removal-progress').textContent='Removing…';
  tableNotice('Removing…');
  try {
    const result=await api('/api/vacancies/remove-many',{workspace:request.workspace,selections:request.rows});
    const removed=new Set(result.removed);
    data.rows=data.rows.filter(r=>!removed.has(r.vacancy_id));
    for(const id of removed){selectedVacancies.delete(id);selected.delete(id);expanded.delete(id);}
    removal=null;$('removal-dialog').close();render();
    tableNotice(`Removed ${removed.size} ${removed.size===1?'vacancy':'vacancies'}. Application records were kept.`);
    await refresh(true);
  }catch(e){
    $('removal-error').hidden=false;$('removal-error').textContent=e.message;$('removal-error').focus();
    $('removal-progress').hidden=true;$('refresh-removal').hidden=false;
    tableNotice('Removal failed. '+e.message,true);
  }finally{
    removalBusy=false;pending--;$('confirm-removal').disabled=false;
    $('confirm-removal').textContent='Retry removal';$('cancel-removal').disabled=false;$('refresh-removal').disabled=false;
    renderSelection();renderSetup();
  }
}
function mainRows() { return data.rows.filter(r=>r.fit==='match'||r.manual||r.applications.length); }
function fitLabel(fit) { return ({match:'Matches preferences',rejected:'Doesn’t match preferences',needs_clarification:'Needs review',unassessed:'Not assessed'})[fit]||'Not assessed'; }
function updateCounts() {
  if(!data)return;
  const rows=$('show-inspected').checked?data.rows:mainRows();
  const applied=rows.filter(r=>r.applied).length;
  $('total').textContent=rows.length;
  $('summary').textContent=`${rows.length} shown · ${applied} applied · ${data.rows.length} total inspected or added`;
}
function render() {
  $('rows').replaceChildren(); updateCounts();
  const visible=visibleRows();
  $('empty').hidden=visible.length>0;
  $('empty').querySelector('h3').textContent=data.rows.length?'No matching opportunities.':'A fresh start.';
  $('empty').querySelector('p').textContent=data.rows.length?'No matches in this view. Use Show all inspected to review listings that failed or need review.':setup?.ready?'Ready to find your first opportunities.':'Complete the highlighted setup steps.';
  for(const row of visible){
    const tr=node('tr'); tr.dataset.id=row.vacancy_id;
    const add=content=>{const td=node('td');td.append(content);tr.append(td);return td;};
    const selection=node('input');selection.type='checkbox';selection.dataset.vacancySelection=row.vacancy_id;
    selection.setAttribute('aria-label',`Select vacancy · ${row.values.company} · ${row.values.title}`);
    selection.addEventListener('change',()=>{if(selection.checked)selectedVacancies.add(row.vacancy_id);else selectedVacancies.delete(row.vacancy_id);renderSelection();});
    add(selection).className='selection-cell';
    add(cell(row,'company','Company'));
    const role=add(cell(row,'title','Role'));
    const link=node('a','Open vacancy ↗','role-link');link.href=row.values.url;link.target='_blank';link.rel='noopener noreferrer';role.append(link);
    role.append(node('span',fitLabel(row.fit),'fit '+row.fit));
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
      pick.value=selected.get(row.vacancy_id)||'';pick.addEventListener('change',()=>{if(queues.has(row.vacancy_id)||[...drafts.keys()].some(k=>k.startsWith(row.vacancy_id+':'))){error('Save or retry this row before choosing another application.');pick.value=selected.get(row.vacancy_id)||'';return;}selected.set(row.vacancy_id,pick.value);render();});group.append(node('label','Choose a candidacy; Application status edits that record.'),pick);grid.append(group);
    }
    field('url','Vacancy URL');field('location','Location');field('review','Review choice',['unreviewed','shortlisted','dismissed']);
    field('applied_at','Applied date (blank = unknown)');field('next_interview','Next interview');field('next_interview_at','Interview date/time (include timezone offset)');
    field('interview_stages','Interview stages (separate with ;)');field('application_notes','Application notes',null,true);field('description','Description correction',null,true);
    const remove=node('button','Remove vacancy','quiet remove-vacancy');remove.type='button';
    remove.disabled=data.job?.state==='running';remove.title=remove.disabled?'Wait for the search to finish before removing a vacancy.':'';
    remove.addEventListener('click',()=>openRemoval([row.vacancy_id]));grid.append(remove);
    const evidence=node('details',undefined,'wide');evidence.append(node('summary','Source evidence & fit checks · read-only'));
    evidence.append(node('pre',JSON.stringify({availability:row.availability,corrected_fields:row.corrected_fields,source:row.original,checks:row.checks},null,2)));grid.append(evidence);
    toggle.addEventListener('click',()=>{detail.hidden=!detail.hidden;if(detail.hidden)expanded.delete(row.vacancy_id);else expanded.add(row.vacancy_id);toggle.textContent=detail.hidden?'Details ↓':'Close details ↑';toggle.setAttribute('aria-expanded',String(!detail.hidden));});
    $('rows').append(tr,detail);
  }
  renderSelection();
}
async function refresh(initial=false){
  if(!workspace)return;
  try{
    const incoming=await api('/api/workspace?path='+encodeURIComponent(workspace));
    trackerError='';
    if(initial||(!pending&&!drafts.size&&!document.activeElement?.closest('#rows'))){data=incoming;render();}
    $('board').hidden=false;
    if(data)data.job=incoming.job;
    renderSelection();
    if(!countEdited&&incoming.config?.criteria)$('count').value=incoming.config.criteria.target_count;
    $('workspace-message').textContent='Changes save in '+incoming.workspace;
    renderSetup();
    $('job').hidden=!incoming.job;$('job').textContent=incoming.job?.message||'';
    $('unlinked').hidden=!incoming.unlinked_applications.length;
    $('unlinked-rows').replaceChildren(...incoming.unlinked_applications.map(a=>node('div',`${a.company} · ${a.position} · ${a.status} · ${a.vacancy_link}`)));
    clearTimeout(poll);if(incoming.job?.state==='running')poll=setTimeout(()=>refresh(),2000);
    return true;
  }catch(e){trackerError=e.message;renderSetup();error(e.message);return false;}
}
function workspaceActionLabel() {
  const hasPath=!!$('workspace').value.trim();
  $('open-workspace').textContent=hasPath?'Open workspace':'Select workspace';
  $('browse-workspace').hidden=!hasPath;
}
async function selectWorkspace() {
  $('open-workspace').disabled=true;$('browse-workspace').disabled=true;
  try {
    const result=await api('/api/select-workspace',{});
    if(!result.workspace)return false;
    $('workspace').value=result.workspace;workspaceActionLabel();return true;
  } finally {$('open-workspace').disabled=false;$('browse-workspace').disabled=false;}
}
async function openWorkspace() {
  if(pending||drafts.size){error('Finish or retry unsaved edits before switching workspaces.');return;}
  error();
  try {if(!$('workspace').value.trim()&&!await selectWorkspace())return;}catch(e){error(e.message);return;}
  selectedVacancies.clear();tableNotice();
  clearTimeout(poll);$('board').hidden=true;data=null;countEdited=false;workspace=$('workspace').value.trim();
  const url=new URL(location.href);url.searchParams.set('workspace',workspace);history.replaceState(null,'',url);
  trackerError='';setup=null;await recheckSetup();if(setup?.checks.find(c=>c.key==='workspace')?.state==='ready')await refresh(true);
}
$('workspace').addEventListener('input',workspaceActionLabel);
$('workspace-form').addEventListener('submit',e=>{e.preventDefault();openWorkspace();});
$('browse-workspace').addEventListener('click',async()=>{
  if(pending||drafts.size){error('Finish unsaved table edits before switching workspaces.');return;}
  try {if(await selectWorkspace())await openWorkspace();}catch(e){error(e.message);}
});
$('count').addEventListener('input',()=>{countEdited=true;});
$('ai-calls').addEventListener('input',renderSetup);
$('find-form').addEventListener('submit',async e=>{e.preventDefault();error();try{await api('/api/find',{workspace,count:Number($('count').value),max_ai_calls:Number($('ai-calls').value)});await refresh();}catch(e){error(e.message);}});
$('recheck').addEventListener('click',async()=>{error();await recheckSetup();if(workspace&&setup?.checks.find(c=>c.key==='workspace')?.state==='ready')await refresh();});
$('refresh').addEventListener('click',()=>{if(pending||drafts.size){error('Your unsaved edits are still visible. Save or retry them before refreshing.');return;}recheckSetup().then(()=>refresh(true));});
$('adopt').addEventListener('click',async()=>{if(pending||drafts.size){error('Finish unsaved edits before importing applications.');return;}try{await api('/api/adopt-applications',{workspace});await refresh(true);}catch(e){error(e.message);}});
$('show-inspected').addEventListener('change',()=>{if(pending||drafts.size){$('show-inspected').checked=!$('show-inspected').checked;error('Finish unsaved edits before changing this view.');return;}selectedVacancies.clear();render();});
$('add-vacancy').addEventListener('click',()=>{
  if(pending||drafts.size){error('Finish unsaved edits before adding a vacancy.');return;}
  $('vacancy-error').hidden=true;$('vacancy-dialog').showModal();$('vacancy-company').focus();
});
$('close-vacancy').addEventListener('click',()=>$('vacancy-dialog').close());
$('vacancy-form').addEventListener('submit',async e=>{
  e.preventDefault();$('save-vacancy').disabled=true;$('vacancy-error').hidden=true;
  try {
    const result=await api('/api/vacancies/add',{workspace,values:{company:$('vacancy-company').value,title:$('vacancy-title').value,url:$('vacancy-url').value}});
    $('vacancy-dialog').close();$('vacancy-form').reset();selectedVacancies.clear();filter='all';$('query').value='';
    document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.filter==='all');b.setAttribute('aria-pressed',String(b.dataset.filter==='all'));});
    expanded.add(result.row.vacancy_id);if(!result.created)$('show-inspected').checked=true;
    await refresh(true);
    [...$('rows').children].find(tr=>tr.dataset.id===result.row.vacancy_id)?.scrollIntoView({block:'nearest'});
    $('job').hidden=false;$('job').textContent=result.created?'Vacancy added. Edit its details in the table.':'This URL is already tracked. Opened the existing vacancy.';
  }catch(e){$('vacancy-error').hidden=false;$('vacancy-error').textContent=e.message;}
  finally{$('save-vacancy').disabled=false;}
});
$('query').addEventListener('input',()=>{selectedVacancies.clear();render();});
$('select-visible').addEventListener('change',()=>{for(const row of visibleRows()){if($('select-visible').checked)selectedVacancies.add(row.vacancy_id);else selectedVacancies.delete(row.vacancy_id);}renderSelection();});
$('clear-selection').addEventListener('click',()=>{selectedVacancies.clear();renderSelection();});
$('remove-selected').addEventListener('click',()=>openRemoval([...selectedVacancies]));
$('removal-form').addEventListener('submit',confirmRemoval);
$('cancel-removal').addEventListener('click',cancelRemoval);
$('removal-dialog').addEventListener('cancel',e=>{e.preventDefault();cancelRemoval();});
$('refresh-removal').addEventListener('click',async()=>{
  if(removalBusy||!removal)return;
  const ids=removal.rows.map(r=>r.vacancy_id);
  removalBusy=true;$('confirm-removal').disabled=true;$('refresh-removal').disabled=true;$('cancel-removal').disabled=true;
  $('removal-progress').hidden=false;$('removal-progress').textContent='Refreshing selection…';
  try {
    if(await refresh(true)){if(openRemoval(ids))tableNotice('Selection refreshed. Review the vacancies before retrying.');}
    else {$('removal-error').hidden=false;$('removal-error').textContent='Could not refresh. Your selection is kept. Retry when connected.';}
  }finally{
    removalBusy=false;$('confirm-removal').disabled=false;$('refresh-removal').disabled=false;$('cancel-removal').disabled=false;
    $('removal-progress').hidden=true;renderSelection();renderSetup();
  }
});
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{selectedVacancies.clear();filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();}));
window.addEventListener('beforeunload',e=>{if(pending||drafts.size){e.preventDefault();e.returnValue='';}});
(async()=>{try{const session=await api('/api/session');workspace=new URL(location.href).searchParams.get('workspace')||session.workspace||'';$('workspace').value=workspace;workspaceActionLabel();await recheckSetup();if(workspace)await refresh(true);}catch(e){error(e.message);}})();
