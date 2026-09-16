# OTO — 音のプレイグラウンド

**Make a little noise.** 考えるより、鳴らしてみよう。

4つの音と16ステップで、自分だけの短い音楽ループを作れる静的Webアプリです。クリーム色の背景とライム色のアクセント、音に反応するグラフィックを組み合わせています。このリポジトリではOTOのみを管理し、サイト本体をルートディレクトリに配置しています。

## できること

- Bell / Keys / Bass / Beat の4トラックをクリック・タップ・マウスドラッグで編集。
- 再生・停止、60〜160 BPMのテンポ調整、音量調整、トラックごとのミュート。
- Daydream / Afterglow / Nightwalk の3プリセット、おまかせ生成、クリア、最大30編集の取り消し。
- ブラウザへの自動保存と、URLによるループの共有。
- 音に反応するCanvasグラフィック、スマートフォン表示、キーボード操作、動きを減らす設定への対応。

音はWeb Audio APIで合成します。アプリ本体は外部ライブラリ、CDN、外部フォント、音声素材、マイク、ログイン、バックエンドを使いません。ページを開いただけでは再生せず、非表示タブでは停止します。

## ローカルで使う

リポジトリのルートで実行します。

```sh
python -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開いてください。ビルドや `npm install` は不要です。`index.html` を直接開くこともできますが、保存・共有の確認にはHTTP経由を推奨します。

## GitHub Pagesで公開する

リポジトリの **Settings → Pages → Build and deployment** で次の設定を保存してください。

| 項目 | 設定 |
| --- | --- |
| Source | Deploy from a branch |
| Branch | main |
| Folder | / (root) |

公開後のURLは `https://nakurei.github.io/try-codex-chat-site-2/` です。ルートの `index.html` がOTOを表示します。`.nojekyll` を同梱しており、独自のデプロイワークフローは不要です。同梱のGitHub ActionsはOTOのテスト専用で、Pagesの公開設定を変更しません。

## 操作

| 操作 | 動作 |
| --- | --- |
| マスをクリック・タップ | 音のオン／オフ。停止中はオンにした音を試聴 |
| マウスドラッグ | 複数の音をまとめて描画。1回の「戻す」で取り消し |
| 音の名前 | トラックのミュート／解除 |
| Space | 再生／停止。入力欄やボタンでは標準操作を優先 |
| R | おまかせ生成 |
| 矢印キー | フォーカス中のマスから隣のマスへ移動 |
| Enter / Space | フォーカス中のボタンを操作 |
| ? / Escape | 遊び方を開く／ダイアログを閉じる |

スマートフォンではマスのエリアを横スクロールできます。タッチでのドラッグ描画は行わず、スクロール操作を優先します。

## 保存と共有

パターン・テンポ・音量などは利用中のブラウザの `localStorage` に保存します。保存が禁止されている場合も音作りはできますが、自動保存されないことを表示します。ブラウザのサイトデータを消すと保存したループも失われます。

共有URLにはパターン・テンポ・ミュート状態が含まれます。共有先の再生音量は上書きしません。サーバーへの音声アップロードや端末間の自動同期はありません。別端末へ共有するURLは、ローカルのファイルやlocalhostではなく、公開サイトから作成してください。

## ファイル構成

```text
index.html                 ページ構造・操作UI
styles.css                 配色・レイアウト・レスポンシブ対応
core.js                    パターン・検証・共有データの純粋関数
app.js                     UI・音声合成・保存・Canvas
favicon.svg                サイトアイコン
.nojekyll                  GitHub Pagesの静的配信用
.github/workflows/test.yml OTOの単体・ブラウザテスト
tests/
  core.test.cjs           Node.jsの単体テスト
  dom_test.py             DOM・実音声出力のブラウザテスト
  requirements.txt        ブラウザテスト用の依存パッケージ
```

## テスト

リポジトリのルートから実行します。単体テストはNode.js 18以上で動き、追加パッケージは不要です。

```sh
node --check core.js
node --check app.js
node --test tests/core.test.cjs
```

ブラウザテストにはPython、Playwright、Chromiumを使用します。これらはテスト用であり、サイトの利用には不要です。

```sh
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
python tests/dom_test.py
```

Linuxでブラウザの依存ライブラリも必要な場合は `python -m playwright install --with-deps chromium` を使用してください。`CHROMIUM_PATH` でChromiumの実行ファイルを指定できます。画面キャプチャと結果は `test-results/` に出力します。

単体テスト7件、ブラウザテスト42項目です。ブラウザテストはHTMLをメモリ内に読み込み、実際のWeb Audio出力と停止後の無音、操作、共有データの復元、320〜1440pxのレイアウトを検証します。Web Storageは明示的なモックを使うため、ネイティブの保存権限、HTTP配信、実端末のスピーカー出力、公開後のクリップボード権限はこのテストの範囲外です。
