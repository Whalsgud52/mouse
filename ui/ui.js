(() => {
  const root=document.getElementById('mouse-fullscreen-flow');
  const connect=root.querySelector('.ff-connect');
  const mouse=root.querySelector('.ff-mouse');
  const layer=root.querySelector('.ff-settings-layer');
  const body=root.querySelector('.ff-body');
  const power=root.querySelector('.ff-power');
  const live=root.querySelector('.ff-live');
  const guide=root.querySelector('.ff-guide-layer');
  const help=root.querySelector('.ff-help-layer');
  const STORAGE_KEY='mouse-ui-settings-v2';
  let saved=null;
  try { saved=JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {}
  if(!saved){try{const old=JSON.parse(localStorage.getItem('iphone-mouse-axis-sensitivity-v1'));if(old)saved={kind:'mouse-fullscreen-flow',settings:old};}catch{}}
  const previousSettings=saved?.kind==='mouse-fullscreen-flow'?saved.settings:{};
  const validAxis=(value,fallback)=>Number.isFinite(value)&&value>=0.5&&value<=10?value:fallback;
  const state={x:validAxis(previousSettings?.x,3),y:validAxis(previousSettings?.y,6),haptic:typeof previousSettings?.haptic==='boolean'?previousSettings.haptic:true};
  let onboardingComplete=saved?.kind==='mouse-fullscreen-flow'&&saved.onboardingComplete===true;
  let guideIndex=0;
  const presses=new Map();
  const guideSteps=[
    {target:'.ff-left',title:'좌클릭과 드래그',description:'가볍게 탭하면 좌클릭. 꾹 누른 채 휴대폰을 움직이면 드래그하고, 손을 떼면 놓아요.'},
    {target:'.ff-right',title:'우클릭',description:'오른쪽 영역을 가볍게 탭하면 우클릭해요.'},
    {target:'.ff-wheel-zone',title:'휠과 햅틱',description:'가운데 휠을 위아래로 밀어 스크롤해요. 햅틱은 설정의 진동 아이콘으로 켜고 꺼요.'},
    {target:'.ff-power',title:'전원 ON / OFF',description:'아래 전원 버튼으로 마우스 조작을 켜고 꺼요.'},
    {target:'.ff-body',title:'설정과 도움말',description:'몸통을 두 번 탭하면 설정이 열려요. ↔는 좌우, ↕는 상하 감도예요. 설정 바깥을 두 번 탭하면 닫혀요.'}
  ];
  let enabled=true;
  let offset=0;
  let connecting=false;
  function announce(text){live.textContent=text;}
  function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({kind:'mouse-fullscreen-flow',settings:state,onboardingComplete}));}catch{}}
  function sync(){
    root.querySelectorAll('[data-axis]').forEach(input=>{input.value=state[input.dataset.axis];input.parentElement.querySelector('output').textContent=Number(input.value).toFixed(1)+'×';});
    root.querySelector('[data-haptic]').checked=state.haptic;
  }
  function releasePresses(){
    presses.forEach((press,button)=>{clearTimeout(press.timer);if(press.downSent)sendInput({type:'button',button:'left',action:'up'},true);button.classList.remove('ff-pressed','ff-dragging');});
    presses.clear();
  }
  function settings(open){
    releasePresses();
    layer.hidden=!open;
    body.setAttribute('aria-expanded',String(open));
    body.setAttribute('aria-label',open?'몸통 두 번 탭으로 설정 닫기':'몸통 두 번 탭으로 설정 열기');
    if(open){root.querySelector('[data-close]').focus();announce('설정 열림');}else{body.focus();announce('설정 닫힘');}
    save();notifyInteraction();
  }
  function showGuideStep(){
    root.querySelectorAll('.ff-tour-target').forEach(element=>element.classList.remove('ff-tour-target'));
    const step=guideSteps[guideIndex];
    root.querySelector(step.target).classList.add('ff-tour-target');
    root.querySelector('#ff-guide-title').textContent=step.title;
    root.querySelector('#ff-guide-description').textContent=step.description;
    root.querySelector('.ff-guide-count').textContent=(guideIndex+1)+' / '+guideSteps.length;
    root.querySelector('[data-guide-previous]').disabled=guideIndex===0;
    const next=root.querySelector('[data-guide-next]');
    next.firstChild.textContent=guideIndex===guideSteps.length-1?'시작하기 ':'다음 ';
    next.focus();
    announce(step.title+' · '+step.description);
  }
  function startGuide(){
    releasePresses();help.hidden=true;guide.hidden=false;settings(false);guideIndex=0;showGuideStep();notifyInteraction();
  }
  function finishGuide(){
    guide.hidden=true;onboardingComplete=true;
    root.querySelectorAll('.ff-tour-target').forEach(element=>element.classList.remove('ff-tour-target'));
    save();body.focus();announce('안내 완료. 설정의 도움말에서 사용법을 다시 볼 수 있어요.');notifyInteraction();
  }
  root.querySelector('[data-guide-next]').addEventListener('click',()=>{if(guideIndex===guideSteps.length-1)finishGuide();else{guideIndex++;showGuideStep();}});
  root.querySelector('[data-guide-previous]').addEventListener('click',()=>{if(guideIndex>0){guideIndex--;showGuideStep();}});
  root.querySelector('[data-guide-skip]').addEventListener('click',finishGuide);
  root.querySelector('[data-help]').addEventListener('click',()=>{releasePresses();help.hidden=false;notifyInteraction();root.querySelector('[data-help-close]').focus();});
  function closeHelp(){help.hidden=true;root.querySelector('[data-help]').focus();notifyInteraction();}
  root.querySelector('[data-help-close]').addEventListener('click',closeHelp);
  root.querySelector('[data-guide-replay]').addEventListener('click',startGuide);
  function trapModal(modal,onEscape){
    modal.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();onEscape();return;}
      if(event.key!=='Tab')return;
      const buttons=[...modal.querySelectorAll('button,input')].filter(element=>!element.disabled);
      const first=buttons[0],last=buttons[buttons.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    });
  }
  trapModal(help,closeHelp);trapModal(guide,finishGuide);
  let connected=false,demo=false,transport=null,lastHaptic=0,lastPause=null;
  const emit=(name,detail)=>window.dispatchEvent(new CustomEvent('mouseui:'+name,{detail}));
  function canOperate(){return enabled&&!mouse.hidden&&layer.hidden&&help.hidden&&guide.hidden&&!document.hidden;}
  function sendInput(message,release=false){
    if(!connected||demo||(!release&&!canOperate()))return false;
    emit('input',{...message});return true;
  }
  function hapticTick(){
    if(!state.haptic||!connected||demo||performance.now()-lastHaptic<45)return;
    lastHaptic=performance.now();emit('haptic',{kind:'selection'});
  }
  function notifyInteraction(){
    const paused=!connected||demo||!canOperate();
    if(paused!==lastPause){lastPause=paused;emit('pause',{paused});}
  }
  function disconnectUI(){
    releasePresses();connected=false;demo=false;transport=null;emit('disconnectrequest',{});notifyInteraction();
  }
  function showMouse(isDemo,kind){
    connected=!isDemo;demo=isDemo;transport=kind;
    connect.hidden=true;mouse.hidden=false;
    const icon=root.querySelector('.ff-current-transport');
    if(icon){const next=document.createElement('i');next.className='ff-current-transport';next.dataset.lucide=isDemo?'monitor':kind==='usb'?'cable':'bluetooth';next.setAttribute('aria-hidden','true');icon.replaceWith(next);globalThis.lucide?.createIcons();}
    if(!onboardingComplete)startGuide();else{power.focus();notifyInteraction();}
    announce(isDemo?'화면 미리보기 · 실제 연결 없음':'연결 완료');
  }
  root.querySelectorAll('[data-transport]').forEach(button=>button.addEventListener('click',()=>{
    const kind=button.dataset.transport==='USB-C'?'usb':'bluetooth';
    root.querySelector('.ff-connect-status').textContent='연결을 기다리고 있어요';
    emit('connectrequest',{transport:kind});
  }));
  root.querySelector('[data-demo]').addEventListener('click',()=>showMouse(true,'demo'));
  window.MouseUI=Object.freeze({
    setConnection(value){
      if(value?.connected===true){
        if(connected&&transport===(value.transport||'bluetooth'))return;
        releasePresses();showMouse(false,value.transport||'bluetooth');
      }else{
        releasePresses();connected=false;demo=false;transport=null;guide.hidden=true;help.hidden=true;
        root.querySelectorAll('.ff-tour-target').forEach(element=>element.classList.remove('ff-tour-target'));
        settings(false);mouse.hidden=true;connect.hidden=false;notifyInteraction();
        root.querySelector('.ff-connect-status').textContent=value?.message||'연결 방식을 선택하세요';
        root.querySelector('[data-transport]').focus();
      }
    },
    setConnectionStatus(message){root.querySelector('.ff-connect-status').textContent=String(message);},
    getState(){return {connected,demo,transport,enabled,settings:{...state},paused:!connected||demo||!canOperate()};},
    openHelp(){if(mouse.hidden)return;releasePresses();help.hidden=false;notifyInteraction();root.querySelector('[data-help-close]').focus();},
    preview(){disconnectUI();showMouse(true,'demo');}
  });

  function bindDoubleTap(target,activate){
    let press=null,previous=null;
    target.addEventListener('pointerdown',event=>{
      if(!event.isPrimary||event.button!==0)return;
      press={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp,moved:false};
      target.setPointerCapture(event.pointerId);
    });
    target.addEventListener('pointermove',event=>{
      if(press?.id===event.pointerId&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>18)press.moved=true;
    });
    target.addEventListener('pointerup',event=>{
      if(press?.id!==event.pointerId)return;
      const valid=!press.moved&&event.timeStamp-press.time<=280;
      press=null;
      if(!valid){previous=null;return;}
      const tap={x:event.clientX,y:event.clientY,time:event.timeStamp};
      if(previous&&tap.time-previous.time<=350&&Math.hypot(tap.x-previous.x,tap.y-previous.y)<=28){previous=null;activate();}
      else previous=tap;
    });
    target.addEventListener('pointercancel',()=>{press=null;previous=null;});
    target.addEventListener('lostpointercapture',()=>{press=null;});
    target.addEventListener('click',event=>{if(event.detail===0){previous=null;activate();}});
  }
  bindDoubleTap(body,()=>settings(layer.hidden));
  bindDoubleTap(root.querySelector('.ff-dismiss'),()=>settings(false));
  root.querySelector('[data-close]').addEventListener('click',()=>settings(false));
  root.querySelector('[data-back]').addEventListener('click',()=>{
    disconnectUI();settings(false);mouse.hidden=true;connect.hidden=false;notifyInteraction();
    root.querySelector('.ff-connect-status').textContent='연결 방식을 선택하세요';
    root.querySelector('[data-transport]').focus();
  });
  layer.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();settings(false);}
    if(event.key!=='Tab')return;
    const items=[...layer.querySelectorAll('button,input')].filter(item=>!item.classList.contains('ff-dismiss'));
    const first=items[0],last=items[items.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  power.addEventListener('click',()=>{
    releasePresses();
    enabled=!enabled;mouse.classList.toggle('ff-off',!enabled);power.setAttribute('aria-pressed',String(enabled));power.setAttribute('aria-label',enabled?'마우스 끄기':'마우스 켜기');announce(enabled?'마우스 ON':'마우스 OFF');
    root.querySelectorAll('.ff-click').forEach(button=>{button.disabled=!enabled;button.classList.remove('ff-pressed');});
    root.querySelector('.ff-wheel-input').disabled=!enabled;emit('power',{enabled});notifyInteraction();
  });
  root.querySelectorAll('[data-axis]').forEach(input=>input.addEventListener('input',()=>{state[input.dataset.axis]=Number(input.value);sync();save();emit('settings',{...state});}));
  root.querySelector('[data-haptic]').addEventListener('change',event=>{state.haptic=event.target.checked;save();emit('settings',{...state});announce('햅틱 '+(state.haptic?'켜짐':'꺼짐'));hapticTick();});
  root.querySelectorAll('.ff-click').forEach(button=>{
    button.addEventListener('pointerdown',event=>{
      if(!enabled||!layer.hidden||!guide.hidden||!help.hidden||event.button!==0||presses.has(button))return;
      button.setPointerCapture(event.pointerId);button.classList.add('ff-pressed');
      const press={id:event.pointerId,held:false,downSent:false,timer:null};presses.set(button,press);
      if(button.dataset.side==='left')press.timer=setTimeout(()=>{if(presses.get(button)!==press)return;press.held=true;press.downSent=sendInput({type:'button',button:'left',action:'down'});button.classList.add('ff-dragging');hapticTick();announce('드래그 중 · 누른 채 휴대폰을 움직이고 손을 떼면 놓아요.');},450);
      announce(button.dataset.side==='left'?'좌클릭 누름':'우클릭 누름');
    });
    function release(event,cancelled){
      const press=presses.get(button);if(!press||press.id!==event.pointerId)return;
      clearTimeout(press.timer);presses.delete(button);button.classList.remove('ff-pressed','ff-dragging');
      if(press.downSent)sendInput({type:'button',button:'left',action:'up'},true);else if(!cancelled&&!press.held)sendInput({type:'click',button:button.dataset.side});
      announce(cancelled?'입력 취소':press.held?'드래그 놓음':button.dataset.side==='left'?'좌클릭':'우클릭');
    }
    button.addEventListener('pointerup',event=>release(event,false));
    ['pointercancel','lostpointercapture'].forEach(type=>button.addEventListener(type,event=>release(event,true)));
    button.addEventListener('click',event=>{if(event.detail===0&&canOperate()){sendInput({type:'click',button:button.dataset.side});announce(button.dataset.side==='left'?'좌클릭':'우클릭');}});
  });
  const wheel=root.querySelector('.ff-wheel-input');
  const wheelZone=root.querySelector('.ff-wheel-zone');
  let scrollRemainder=0;
  function scroll(delta){if(!canOperate())return;offset+=delta;root.querySelector('.ff-wheel').style.setProperty('--ff-offset',offset+'px');scrollRemainder+=delta;const ticks=Math.trunc(scrollRemainder/14);if(ticks){scrollRemainder-=ticks*14;sendInput({type:'scroll',dy:Math.max(-20,Math.min(20,-ticks))});hapticTick();}announce('휠 스크롤');}
  let lastY=null,lastValue=0;
  wheel.addEventListener('pointerdown',event=>{if(!enabled)return;event.preventDefault();wheel.focus();lastY=event.clientY;wheel.setPointerCapture(event.pointerId);});
  wheel.addEventListener('pointermove',event=>{if(lastY===null)return;const delta=event.clientY-lastY;if(Math.abs(delta)>2){scroll(delta);lastY=event.clientY;}});
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>wheel.addEventListener(type,()=>{lastY=null;}));
  wheel.addEventListener('input',()=>{const value=Number(wheel.value);scroll(value-lastValue);lastValue=value;});
  wheelZone.addEventListener('wheel',event=>{event.preventDefault();scroll(Math.sign(event.deltaY)*10);},{passive:false});
  mouse.addEventListener('contextmenu',event=>event.preventDefault());
  window.addEventListener('blur',releasePresses);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)releasePresses();notifyInteraction();});
  globalThis.lucide?.createIcons();
  sync();
})();
