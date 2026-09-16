"""Offline DOM + real Web Audio regression tests.

No network navigation is used. Web Storage is mocked explicitly because the
about:blank test document has an opaque origin. Native storage permissions,
HTTP serving and cross-device playback are not covered by this suite.
Run: python tests/dom_test.py (requires playwright and Chromium).
"""
from pathlib import Path
import json
import os
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('OTO_TEST_OUTPUT', ROOT / 'test-results'))
OUT.mkdir(parents=True, exist_ok=True)
HTML = ROOT.joinpath('index.html').read_text(encoding='utf-8')
HTML = HTML.replace('<link rel="stylesheet" href="./styles.css">', '<style>' + ROOT.joinpath('styles.css').read_text(encoding='utf-8') + '</style>')
for tag in ['<script src="./core.js" defer></script>', '<script src="./app.js" defer></script>', '<link rel="icon" href="./favicon.svg" type="image/svg+xml">']:
    HTML = HTML.replace(tag, '')
results, errors = [], []

def check(name, condition):
    assert condition, name
    results.append(name)
    print('PASS', name)

def fresh_page(context, saved=None, fragment='', blocked=False):
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    if fragment:
        page.goto('about:blank#' + fragment)
    page.evaluate('''({saved, blocked}) => {
      const values = new Map(saved ? [['oto:loop:v1', saved]] : []);
      Object.defineProperty(window, 'localStorage', { configurable:true, get() {
        if (blocked) throw new Error('Storage denied');
        return {getItem:k=>values.get(k) ?? null, setItem:(k,v)=>values.set(k,String(v))};
      }});
      window.__contexts=[];
      const Original=window.AudioContext;
      window.AudioContext=class extends Original {
        constructor(...args){super(...args);window.__contexts.push(this);}
        createAnalyser(){const a=super.createAnalyser();window.__analyser=a;return a;}
      };
    }''', {'saved': saved, 'blocked': blocked})
    page.set_content(HTML)
    page.add_script_tag(content=ROOT.joinpath('core.js').read_text(encoding='utf-8'))
    page.add_script_tag(content=ROOT.joinpath('app.js').read_text(encoding='utf-8'))
    return page

with sync_playwright() as p:
    options = dict(headless=True, args=['--no-sandbox'])
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
    if executable:
        options['executable_path'] = executable
    browser = p.chromium.launch(**options)
    context = browser.new_context(viewport={'width':1440,'height':1050}, device_scale_factor=1)
    page = fresh_page(context)
    check('64 accessible step controls', page.locator('.step[aria-pressed]').count() == 64)
    check('no autoplay on load', page.evaluate('window.__contexts.length === 0'))
    page.screenshot(path=str(OUT / 'desktop.png'), full_page=True)
    initial = page.locator('.step[aria-pressed="true"]').count()
    cell = page.locator('.step[data-row="0"][data-col="1"]')
    cell.click()
    check('click toggles a note', cell.get_attribute('aria-pressed') == 'true')
    check('editing marks composition custom', page.locator('#loop-title').inner_text() == 'Your loop')
    page.locator('#undo-button').click()
    check('undo restores original notes', page.locator('.step[aria-pressed="true"]').count() == initial)
    page.locator('#play-button').click()
    page.wait_for_timeout(700)
    check('play starts the AudioContext', page.evaluate('window.__contexts[0].state === "running"'))
    check('play toggles accessible transport state', page.locator('#play-button').get_attribute('aria-pressed') == 'true')
    check('playhead advances', page.locator('.step-number.is-current').count() == 1)
    rms_script = '''() => {const data=new Float32Array(window.__analyser.fftSize);window.__analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((s,n)=>s+n*n,0)/data.length)}'''
    rms = page.evaluate(rms_script)
    check('real audio output is nonzero and bounded', 0.00001 < rms < 0.8)
    page.screenshot(path=str(OUT / 'playing.png'), full_page=True)
    page.locator('#play-button').click()
    page.wait_for_timeout(500)
    check('stop clears visual playhead', page.locator('.step.is-current').count() == 0)
    check('stop silences actual audio output', page.evaluate(rms_script) < 0.0001)
    page.locator('[data-preset="nightwalk"]').click()
    check('preset sets tempo and name', page.locator('#tempo').input_value() == '122' and page.locator('#loop-title').inner_text() == 'Nightwalk')
    page.locator('#tempo').fill('135')
    page.locator('#tempo').dispatch_event('change')
    page.locator('#volume').fill('27')
    saved = page.evaluate('localStorage.getItem("oto:loop:v1")')
    stored = json.loads(saved)
    check('edits write valid state to storage adapter', stored['bpm'] == 135 and stored['volume'] == 0.27)
    page = fresh_page(context, saved)
    check('fresh document restores saved state', page.locator('#tempo').input_value() == '135' and page.locator('#volume').input_value() == '27')
    page.locator('[data-mute="1"]').click()
    check('track mute is reflected accessibly', page.locator('[data-mute="1"]').get_attribute('aria-pressed') == 'true')
    page.locator('#clear-button').click()
    check('clear removes all notes', page.locator('.step[aria-pressed="true"]').count() == 0)
    page.locator('#undo-button').click()
    check('clear is reversible', page.locator('.step[aria-pressed="true"]').count() > 0)
    page.locator('#random-button').click()
    check('random includes all four voices', all(page.locator(f'.track[data-row="{r}"] .step[aria-pressed="true"]').count() > 0 for r in range(4)))
    page.locator('#clear-button').click()
    start=page.locator('.step[data-row="0"][data-col="0"]').bounding_box()
    end=page.locator('.step[data-row="0"][data-col="3"]').bounding_box()
    page.mouse.move(start['x']+start['width']/2, start['y']+start['height']/2)
    page.mouse.down()
    page.mouse.move(end['x']+end['width']/2, end['y']+end['height']/2, steps=20)
    page.mouse.up()
    check('mouse drag paints four notes', page.locator('.step[aria-pressed="true"]').count() == 4)
    page.locator('#undo-button').click()
    check('drag undo is one atomic edit', page.locator('.step[aria-pressed="true"]').count() == 0)
    page.locator('[data-preset="afterglow"]').click()
    page.locator('#share-button').click()
    check('clipboard-unavailable fallback shows selectable URL', page.locator('#share-dialog').is_visible())
    shared_url=page.locator('#share-url').input_value()
    page.locator('#share-dialog [data-close]').first.click()
    shared=fresh_page(context, fragment=shared_url.split('#',1)[1])
    check('shared URL decodes in a fresh document', shared.locator('#tempo').input_value() == '76' and shared.locator('#loop-title').inner_text() == 'Afterglow')
    shared.locator('.step[data-row="0"][data-col="1"]').click()
    check('editing removes stale share fragment', '#' not in shared.url)
    corrupt=fresh_page(context, saved='not-json')
    check('corrupt saved JSON falls back to initial pattern', corrupt.locator('#loop-title').inner_text() == 'Daydream')
    corrupt.locator('#random-button').click()
    check('corrupt saved JSON does not disable future saves', json.loads(corrupt.evaluate('localStorage.getItem("oto:loop:v1")'))['version'] == 1)
    invalid=fresh_page(context, fragment='loop=broken')
    check('invalid share URL is rejected without a crash', invalid.locator('.step').count() == 64 and '正しくありません' in invalid.locator('#toast').inner_text())
    page.locator('#help-button').click()
    check('help dialog opens', page.locator('#help-dialog').is_visible())
    page.keyboard.press('Escape')
    check('Escape dismisses help', not page.locator('#help-dialog').is_visible())
    page.locator('.step[data-row="0"][data-col="0"]').focus()
    page.keyboard.press('ArrowRight')
    check('arrow key moves to adjacent step', page.evaluate('document.activeElement.dataset.col === "1"'))
    cell=page.locator('.step[data-row="0"][data-col="1"]')
    before=cell.get_attribute('aria-pressed')
    page.keyboard.press('Enter')
    check('Enter toggles keyboard-focused step', cell.get_attribute('aria-pressed') != before)
    page.evaluate('document.activeElement.blur()')
    page.keyboard.press('Space')
    page.wait_for_timeout(200)
    check('Space starts playback', page.locator('#play-button').get_attribute('aria-pressed') == 'true')
    page.keyboard.press('Space')
    check('Space stops playback', page.locator('#play-button').get_attribute('aria-pressed') == 'false')
    page.locator('#play-button').click()
    page.wait_for_timeout(100)
    page.evaluate('''() => {Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))}''')
    check('hidden-tab event stops audio', page.locator('#play-button').get_attribute('aria-pressed') == 'false')
    page=fresh_page(context)
    for width in [320,390,768,1024,1440]:
        page.set_viewport_size({'width':width,'height':900})
        check(f'no horizontal page overflow at {width}px', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        if width==390:
            page.screenshot(path=str(OUT / 'mobile.png'), full_page=True)
    restricted=fresh_page(context, blocked=True)
    check('storage denial is communicated', '自動保存不可' in restricted.locator('#save-status').inner_text())
    restricted.locator('#random-button').click()
    check('editing works with storage denied', restricted.locator('#loop-title').inner_text() == 'Your loop')
    restricted.emulate_media(reduced_motion='reduce')
    check('reduced motion removes CSS animations', restricted.evaluate('getComputedStyle(document.querySelector(".record-dot")).animationName === "none"'))
    check('no JavaScript runtime errors', not errors)
    report={'passed':len(results),'checks':results,'errors':errors,'audio_rms_while_playing':rms,'mode':'In-memory HTML; real Web Audio; mocked Web Storage'}
    (OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'\n{len(results)} checks passed. Audio RMS: {rms:.6f}. Web Storage was mocked.')
    browser.close()
