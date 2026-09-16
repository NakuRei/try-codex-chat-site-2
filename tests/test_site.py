"""End-to-end tests. Uses isolated browser profiles, never your personal notes.

Run: python -m pip install -r tests/requirements.txt
     python -m playwright install chromium
     python tests/test_site.py
Set CHROMIUM_EXECUTABLE to use a preinstalled Chromium instead.
"""
from __future__ import annotations

import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import unittest

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
KEY = 'yohaku:/:notes:v1'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class YohakuTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/'
        cls.playwright = sync_playwright().start()
        options = {'headless': True}
        if os.environ.get('CHROMIUM_EXECUTABLE'):
            options['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
        cls.browser = cls.playwright.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1060}, locale='ja-JP')
        self.page = self.context.new_page()
        self.page.set_default_timeout(6000)
        self.errors = []
        self.external = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.on('request', lambda request: self.external.append(request.url) if not request.url.startswith(self.url) else None)
        self.page.goto(self.url)
        expect(self.page.locator('.note-card')).to_have_count(5)

    def tearDown(self):
        try:
            self.assertEqual(self.errors, [], 'Unexpected JavaScript errors')
            self.assertEqual(self.external, [], 'Unexpected external requests')
        finally:
            self.context.close()

    def notes(self):
        return self.page.evaluate('(key) => JSON.parse(localStorage.getItem(key)).notes', KEY)

    def create(self, title='新しいノート', body='本文のテスト', tags='テスト', category='ideas'):
        self.page.locator('#new-note').click()
        self.page.locator('#note-title').fill(title)
        self.page.locator('#note-body').fill(body)
        self.page.locator('#note-tags').fill(tags)
        self.page.locator('#note-category').select_option(category)
        self.page.locator('#note-form button[type=submit]').click()
        expect(self.page.locator('#editor')).not_to_be_visible()

    def test_initial_state_and_reload(self):
        ids = [note['id'] for note in self.notes()]
        self.page.reload()
        self.assertEqual(ids, [note['id'] for note in self.notes()])
        expect(self.page.locator('#storage-warning')).not_to_be_visible()
        expect(self.page.locator('[data-count=all]')).to_have_text('5')

    def test_create_edit_and_literal_html(self):
        title = '<img src=x onerror=alert(1)> is just text'
        self.create(title, '<script>window.injection=true</script>', '安全性, テスト, 安全性')
        expect(self.page.locator('.note-card')).to_have_count(6)
        self.assertIsNone(self.page.evaluate('window.injection'))
        expect(self.page.locator('#notes img, #notes script')).to_have_count(0)
        self.page.get_by_role('button', name=title, exact=True).click()
        self.page.locator('#note-title').fill('編集済みのノート')
        self.page.locator('#note-body').fill('保存できた本文')
        self.page.keyboard.press('Control+Enter')
        self.page.reload()
        self.page.get_by_role('button', name='編集済みのノート', exact=True).click()
        expect(self.page.locator('#note-body')).to_have_value('保存できた本文')
        self.assertEqual(self.notes()[0]['tags'], ['安全性', 'テスト'])

    def test_search_categories_tags_and_empty(self):
        self.page.locator('#search').fill('なにもしない')
        expect(self.page.locator('.note-card')).to_have_count(1)
        self.page.locator('#search').fill('no-matching-note')
        expect(self.page.locator('#empty-state')).to_be_visible()
        self.page.locator('#empty-action').click()
        expect(self.page.locator('.note-card')).to_have_count(5)
        self.page.locator('[data-filter=reading]').click()
        expect(self.page.locator('.note-card')).to_have_count(1)
        self.page.locator('[data-filter=all]').click()
        self.page.get_by_role('button', name='# アイデア', exact=True).click()
        expect(self.page.locator('.note-card')).to_have_count(2)
        self.page.locator('#reset-filter').click()
        self.create('ABC test', '半角と全角を検索')
        self.page.locator('#search').fill('ＡＢＣ')
        expect(self.page.locator('.note-card')).to_have_count(1)

    def test_favorite_views_theme_and_sort(self):
        self.page.locator('.card-star').first.click()
        self.page.locator('[data-filter=favorites]').click()
        expect(self.page.locator('.note-card')).to_have_count(1)
        self.page.locator('[data-filter=all]').click()
        self.page.locator('#list-view').click()
        self.page.locator('#theme-toggle').click()
        self.page.locator('#sort').select_option('title')
        self.page.reload()
        expect(self.page.locator('#notes')).to_have_class('notes-grid list-view')
        expect(self.page.locator('html')).to_have_attribute('data-theme', 'dark')
        expect(self.page.locator('#sort')).to_have_value('title')
        self.assertTrue(self.page.evaluate("Array.from(document.querySelectorAll('.card-open')).map(x=>x.textContent).every((x,i,a)=>!i||a[i-1].localeCompare(x,'ja')<=0)"))
        self.page.locator('#sort').select_option('created')
        self.page.locator('#sort').select_option('updated')
        self.page.locator('#grid-view').click()
        self.page.locator('#theme-toggle').click()

    def test_delete_and_unsaved_confirmation(self):
        self.page.locator('.card-open').first.click()
        self.page.locator('#note-body').fill('未保存の変更')
        self.page.keyboard.press('Escape')
        expect(self.page.locator('#confirm-dialog')).to_be_visible()
        self.page.locator('#confirm-dialog button[value=cancel]').click()
        expect(self.page.locator('#editor')).to_be_visible()
        self.page.locator('#close-editor').click()
        self.page.locator('#confirm-ok').click()
        expect(self.page.locator('#editor')).not_to_be_visible()
        self.page.locator('.card-open').first.click()
        self.page.locator('#delete-note').click()
        self.page.locator('#confirm-dialog button[value=cancel]').click()
        self.assertEqual(len(self.notes()), 5)
        self.page.locator('#delete-note').click()
        self.page.locator('#confirm-ok').click()
        expect(self.page.locator('.note-card')).to_have_count(4)
        self.page.reload()
        expect(self.page.locator('.note-card')).to_have_count(4)

    def test_backup_roundtrip_and_invalid_file(self):
        with self.page.expect_download() as info:
            self.page.locator('#export').click()
        backup = json.loads(Path(info.value.path()).read_text(encoding='utf-8'))
        self.assertEqual(len(backup['notes']), 5)
        self.page.locator('.card-open').first.click()
        self.page.locator('#delete-note').click()
        self.page.locator('#confirm-ok').click()
        expect(self.page.locator('.note-card')).to_have_count(4)
        payload = {'name': 'backup.json', 'mimeType': 'application/json', 'buffer': json.dumps(backup).encode()}
        self.page.locator('#import-file').set_input_files(payload)
        self.page.locator('#confirm-ok').click()
        expect(self.page.locator('.note-card')).to_have_count(5)
        self.page.locator('#import-file').set_input_files(payload)
        self.page.locator('#confirm-ok').click()
        expect(self.page.locator('#toast')).to_contain_text('0件')
        self.page.locator('#import-file').set_input_files({'name': 'bad.json', 'mimeType': 'application/json', 'buffer': b'{bad'})
        expect(self.page.locator('#toast')).to_contain_text('読み取れません')
        self.assertEqual(len(self.notes()), 5)

    def test_prompt_and_keyboard(self):
        original = self.page.locator('#prompt-text').inner_text()
        self.page.locator('#shuffle-prompt').click()
        self.assertNotEqual(original, self.page.locator('#prompt-text').inner_text())
        prompt = self.page.locator('#prompt-text').inner_text().replace('\n', '')
        self.page.locator('#use-prompt').click()
        expect(self.page.locator('#note-title')).to_have_value(prompt)
        self.page.locator('#close-editor').click()
        self.page.keyboard.press('/')
        expect(self.page.locator('#search')).to_be_focused()
        self.page.locator('#new-note').focus()
        self.page.keyboard.press('n')
        expect(self.page.locator('#editor')).to_be_visible()
        self.page.locator('#note-title').fill(' ')
        self.page.locator('#note-form button[type=submit]').click()
        expect(self.page.locator('#editor-error')).to_contain_text('タイトル')
        self.page.locator('#note-title').fill('タグが多すぎる')
        self.page.locator('#note-tags').fill(','.join(map(str, range(9))))
        self.page.locator('#note-form button[type=submit]').click()
        expect(self.page.locator('#editor-error')).to_contain_text('8個')

    def test_storage_denied_and_corrupt_data(self):
        page = self.context.new_page()
        page.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Denied','SecurityError')}})")
        page.goto(self.url)
        expect(page.locator('#storage-warning')).to_be_visible()
        expect(page.locator('.note-card')).to_have_count(5)
        page.locator('#new-note').click()
        page.locator('#note-title').fill('一時保存でも書ける')
        page.locator('#note-form button[type=submit]').click()
        expect(page.locator('.note-card')).to_have_count(6)
        page.close()
        self.page.evaluate('(key) => localStorage.setItem(key, "{broken")', KEY)
        self.page.reload()
        expect(self.page.locator('#storage-warning')).to_contain_text('上書きしていません')
        self.create('壊れたデータを上書きしない')
        self.assertEqual(self.page.evaluate('(key) => localStorage.getItem(key)', KEY), '{broken')

    def test_quota_failure(self):
        self.page.evaluate("Storage.prototype.setItem = function(){throw new DOMException('Full','QuotaExceededError')}")
        self.create('容量不足のノート')
        expect(self.page.locator('.note-card')).to_have_count(6)
        expect(self.page.locator('#storage-warning')).to_be_visible()
        self.assertEqual(len(self.notes()), 5)
        with self.page.expect_download() as info:
            self.page.locator('#export').click()
        self.assertEqual(len(json.loads(Path(info.value.path()).read_text())['notes']), 6)

    def test_cross_tab_conflict_protection(self):
        title = self.notes()[0]['title']
        second = self.context.new_page()
        second.goto(self.url)
        self.page.get_by_role('button', name=title, exact=True).click()
        self.page.locator('#note-body').fill('こちらの未保存の変更')
        second.get_by_role('button', name=title, exact=True).click()
        second.locator('#note-body').fill('別タブから保存済み')
        second.locator('#note-form button[type=submit]').click()
        self.page.locator('#note-form button[type=submit]').click()
        expect(self.page.locator('#editor-error')).to_contain_text('別のタブ')
        self.assertEqual(self.notes()[0]['body'], '別タブから保存済み')
        second.close()

    def test_mobile_and_tablet_layout(self):
        for width in [320, 390, 768, 1024, 1440]:
            self.page.set_viewport_size({'width': width, 'height': 900})
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Horizontal overflow at {width}px')
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.locator('#menu-toggle').click()
        self.page.locator('[data-filter=reading]').click()
        expect(self.page.locator('#library-title')).to_have_text('読書の余韻')
        expect(self.page.locator('#menu-toggle')).to_have_attribute('aria-expanded', 'false')
        self.create('スマートフォンでも書ける')
        self.page.locator('#list-view').click()
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))

    def test_empty_library_stays_empty(self):
        self.page.evaluate('(key) => localStorage.setItem(key, JSON.stringify({version:1,notes:[]}))', KEY)
        self.page.reload()
        expect(self.page.locator('.note-card')).to_have_count(0)
        expect(self.page.locator('#empty-state')).to_be_visible()
        self.page.reload()
        expect(self.page.locator('.note-card')).to_have_count(0)
        self.page.locator('#empty-action').click()
        expect(self.page.locator('#editor')).to_be_visible()


if __name__ == '__main__':
    unittest.main(verbosity=2)
