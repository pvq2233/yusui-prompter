import { test, expect, _electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { APPEARANCE_PRESETS } from '../src/appearance';

const root=process.cwd();
async function open() {
  const pending=path.join(root,'client','语随.pending.exe');
  const client=await _electron.launch({executablePath:fs.existsSync(pending)?pending:path.join(root,'client','语随.exe'),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],env:{...process.env,YUSUI_DESKTOP_TEST:'1',YUSUI_APP_ROOT:root,YUSUI_PORT:'8766'}});
  const page=await client.firstWindow(); await page.waitForURL('http://127.0.0.1:8766/');
  await page.evaluate(()=>localStorage.clear()); await page.reload();
  await expect(page.locator('.app')).toBeVisible();
  const native=await client.browserWindow(page); await native.evaluate(win=>{win.show();win.unmaximize();win.setSize(1440,900);}); await native.dispose();
  return {client,page};
}

test('all six themes cover chrome, editors, settings and presenter tools', async()=>{
  const {client,page}=await open();
  try {
    await page.getByRole('button',{name:'提词设置',exact:true}).click();
    await page.getByRole('tab',{name:'字体与颜色',exact:true}).click();
    const colors=new Set<string>();
    for(const preset of APPEARANCE_PRESETS) {
      await page.getByRole('button',{name:preset.name,exact:true}).click();
      const palette=await page.locator('.app').evaluate(el=>{
        const style=getComputedStyle(el);
        const color=(selector:string,property:string)=>getComputedStyle(document.querySelector(selector)! ).getPropertyValue(property);
        return {surface:style.getPropertyValue('--ui-surface').trim(),raised:style.getPropertyValue('--ui-raised').trim(),header:color('.app-header','background-color'),sidebar:color('.sidebar','background-color'),main:color('.main','background-color'),modal:color('.modal','background-color')};
      });
      const rgb=(hex:string)=>'rgb('+[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')+')';
      expect(palette.header).toBe(rgb(palette.surface)); expect(palette.sidebar).toBe(rgb(palette.surface)); expect(palette.modal).toBe(rgb(palette.raised)); colors.add(palette.header);
      await expect(page.locator('.brand-symbol')).toHaveCSS('background-color','rgb(192, 230, 187)');
      if(preset.id==='paper') await page.screenshot({path:'../full-theme-paper-settings.png'});
    }
    expect(colors.size).toBe(6);
    await page.getByRole('button',{name:'暖纸书页',exact:true}).click();
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
    await page.getByRole('button',{name:'编辑讲稿',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'讲稿正文',exact:true})).toHaveCSS('color',await page.locator('.app').evaluate(el=>getComputedStyle(el).color));
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.screenshot({path:'../full-theme-paper-client.png'});
    const ready=client.waitForEvent('window'); await page.getByRole('button',{name:'主播窗口',exact:true}).click(); const popup=await ready;
    await expect(popup.locator('.current-sentence')).toBeVisible();
    await expect(popup.locator('.presenter-screen')).toHaveCSS('background-color','rgb(243, 234, 217)');
    const pn=await client.browserWindow(popup);await pn.evaluate(win=>win.show());await pn.dispose();
    await popup.mouse.move(40,100);
    await popup.screenshot({path:'../full-theme-paper-presenter.png'});
  } finally {await client.close();}
});

test('spoken end loops after five seconds with fresh audio generation, preserving browsing and honoring cancellation',async()=>{
  const {client,page}=await open();
  let generation=0;
  const anchors=()=>page.evaluate(()=>JSON.parse((window as any).__loopTestTransport.anchors));
  try {
    await page.route('**/api/status',route=>route.fulfill({json:{app:'whisper-live-prompter',state:'ready',model:'small',device:'cuda',compute_type:'float16'}}));
    await page.evaluate(()=>{localStorage.setItem('yusui-script',JSON.stringify('开场欢迎大家。\n\n最后一句谢谢大家！！'));}); await page.reload();
    // A deterministic local transport supplies model positions while the actual
    // Capture/AudioWorklet pipeline uses Chromium's fake microphone, never real audio.
    await page.evaluate(()=>{
      const RealSocket=window.WebSocket;
      const messages:any[]=[];
      let instance:any;
      class LocalSocket extends EventTarget {
        static OPEN=RealSocket.OPEN;static CLOSING=RealSocket.CLOSING;static CLOSED=RealSocket.CLOSED;
        readyState=RealSocket.OPEN;bufferedAmount=0;onmessage:any;onclose:any;onerror:any;
        constructor(){super();instance=this;queueMicrotask(()=>this.deliver({type:'ready',generation:0}));}
        deliver(data:any){this.onmessage?.({data:JSON.stringify(data)});}
        send(data:any){if(typeof data!=='string')return;const message=JSON.parse(data);if(message.type==='start'||message.type==='seek')messages.push(message);if(message.type==='stop')this.close();}
        close(){this.readyState=RealSocket.CLOSED;queueMicrotask(()=>{this.onclose?.();this.dispatchEvent(new Event('close'));});}
      }
      (window as any).WebSocket=LocalSocket;
      (window as any).__loopTestTransport={get anchors(){return JSON.stringify(messages);},position(offset:number,oldGeneration?:number){instance.deliver({type:'position',generation:oldGeneration??messages.at(-1).generation,paragraph:1,offset,confidence:.99});}};
    });
    await page.getByRole('button',{name:'提词设置',exact:true}).click();await page.getByRole('tab',{name:'显示与语言',exact:true}).click();
    await page.getByRole('switch',{name:'循环跟读',exact:true}).check(); await page.getByRole('button',{name:'关闭设置',exact:true}).click();
    await page.getByRole('button',{name:'开始识别',exact:true}).click();await expect(page.getByRole('button',{name:'停止识别',exact:true})).toBeVisible();
    await expect.poll(async()=> (await anchors()).length).toBeGreaterThan(0);
    await page.clock.install(); await page.clock.pauseAt(new Date());
    const ready=client.waitForEvent('window');await page.getByRole('button',{name:'主播窗口',exact:true}).click();const popup=await ready;await expect(popup.locator('.current-sentence')).toBeVisible();
    const position=(offset:number,gen?:number)=>page.evaluate(({offset,gen})=>(window as any).__loopTestTransport.position(offset,gen),{offset,gen});
    await position(4);await expect(page.locator('article.current')).toHaveAttribute('data-paragraph','1'); await expect(page.locator('.loop-countdown')).toHaveCount(0);
    await page.locator('.prompter-scroll').hover(); await page.mouse.wheel(0,150);await expect(page.getByRole('button',{name:'回到跟读位置',exact:true})).toBeVisible();
    const viewed=await page.locator('.prompter-scroll').evaluate(el=>el.scrollTop);
    await position(8);await expect(page.locator('.loop-countdown strong')).toHaveText('5');await expect(popup.locator('.loop-countdown strong')).toHaveText('5');
    const oldGeneration=(await anchors()).at(-1).generation; const before=(await anchors()).length;
    await page.clock.runFor(2000);await position(8);await expect(page.locator('.loop-countdown strong')).toHaveText('3');
    await page.clock.runFor(2900);await expect(page.locator('article.current')).toHaveAttribute('data-paragraph','1');expect((await anchors()).length).toBe(before);
    await page.clock.runFor(200);await expect(page.locator('article.current')).toHaveAttribute('data-paragraph','0');await expect(popup.locator('article.current')).toHaveAttribute('data-paragraph','0');
    await expect.poll(async()=>(await anchors()).length).toBe(before+1);generation=(await anchors()).at(-1).generation;expect(generation).toBeGreaterThan(oldGeneration);expect((await anchors()).at(-1)).toMatchObject({type:'seek',paragraph:0,offset:0});
    expect(await page.locator('.prompter-scroll').evaluate(el=>el.scrollTop)).toBeCloseTo(viewed,0);await expect(page.getByRole('button',{name:'停止识别',exact:true})).toBeVisible();
    await position(8,oldGeneration);await expect(page.locator('.loop-countdown')).toHaveCount(0);await expect(page.locator('article.current')).toHaveAttribute('data-paragraph','0');
    await position(8);await expect(page.locator('.loop-countdown strong')).toHaveText('5');await page.screenshot({path:'../loop-countdown-client.png'});await popup.screenshot({path:'../loop-countdown-presenter.png'});await page.getByRole('button',{name:'暂停跟读',exact:true}).click();await page.clock.runFor(6000);await expect(page.locator('.loop-countdown')).toHaveCount(0);await expect(page.locator('article.current')).toHaveAttribute('data-paragraph','1');
    await page.getByRole('button',{name:'恢复跟读',exact:true}).click();await position(8);await expect(page.locator('.loop-countdown strong')).toHaveText('5');await page.getByRole('button',{name:'跳转到第 1 段',exact:true}).click();await page.clock.runFor(6000);await expect(page.locator('.loop-countdown')).toHaveCount(0);
    await position(8);await expect(page.locator('.loop-countdown strong')).toHaveText('5');await page.getByRole('button',{name:'提词设置',exact:true}).click();await page.getByRole('switch',{name:'循环跟读',exact:true}).uncheck();await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.clock.runFor(6000);await expect(page.locator('.loop-countdown')).toHaveCount(0);await expect(page.locator('article.current')).toHaveAttribute('data-paragraph','1');
    await position(8);await expect(page.locator('.loop-countdown')).toHaveCount(0);
    await page.getByRole('button',{name:'停止识别',exact:true}).click();await expect(page.getByRole('button',{name:'开始识别',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'提词设置',exact:true}).click();await page.getByRole('switch',{name:'循环跟读',exact:true}).check();await page.getByRole('button',{name:'关闭设置',exact:true}).click();
    await page.reload();await page.getByRole('button',{name:'提词设置',exact:true}).click();await page.getByRole('tab',{name:'显示与语言',exact:true}).click();await expect(page.getByRole('switch',{name:'循环跟读',exact:true})).toBeChecked();
    await page.screenshot({path:'../loop-settings-preview.png'});
  } finally {await client.close();}
});
