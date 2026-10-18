import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { AppError } from './errors.mjs';

export class Config {
  constructor({ directory = process.env.SOKOMADE_CONFIG_DIR || join(homedir(), 'Library', 'Application Support', 'Sokomade'), env = process.env } = {}) {
    this.directory = directory;
    this.file = join(directory, 'settings.json');
    this.env = env;
  }
  async keys() {
    let saved = {};
    try { saved = JSON.parse(await readFile(this.file, 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT') throw new AppError('CONFIG_UNREADABLE', '地図APIの設定を読み込めません。設定画面から保存し直してください。');
    }
    return {
      server: this.env.GOOGLE_MAPS_API_KEY || saved.serverKey || '',
      browser: this.env.GOOGLE_MAPS_BROWSER_KEY || saved.browserKey || '',
    };
  }
  async status() {
    const keys = await this.keys();
    return { serverConfigured: !!keys.server, browserConfigured: !!keys.browser, provider: 'google', storesConversation: false, aiConfigured: !!this.env.OPENAI_API_KEY };
  }
  async save({ serverKey, browserKey }) {
    const previous = await this.keys();
    const keys = { serverKey: serverKey?.trim() || previous.server, browserKey: browserKey?.trim() || previous.browser };
    if (!keys.serverKey || !keys.browserKey || Object.values(keys).some(value => !/^[A-Za-z0-9_-]{20,200}$/.test(value))) {
      throw new AppError('INVALID_KEY', 'サーバー用とブラウザ用のAPIキーを入力してください。キーに空白や改行は含められません。');
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(this.file, JSON.stringify(keys), { mode: 0o600 });
    await chmod(this.file, 0o600);
    return this.status();
  }
}
