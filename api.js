// Talks to the Krishi Saathi backend. Set EXPO_PUBLIC_API_URL in mobile/.env
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { fetch as streamingFetch } from 'expo/fetch';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/$/, '');

let deviceIdPromise = null;
export function getDeviceId() {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      let id = await AsyncStorage.getItem('ks_device');
      if (!id) { id = Crypto.randomUUID(); await AsyncStorage.setItem('ks_device', id); }
      return id;
    })();
  }
  return deviceIdPromise;
}

async function headers(json = true) {
  const h = { 'X-Device-Id': await getDeviceId(), 'X-Channel': 'app' };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch(API_URL + path, {
    method,
    headers: await headers(!form),
    body: form || (body != null ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

// Minimal UTF-8 decoder in case TextDecoder is missing on an older engine.
function makeDecoder() {
  if (typeof TextDecoder !== 'undefined') {
    const d = new TextDecoder('utf-8');
    return chunk => d.decode(chunk, { stream: true });
  }
  let pending = [];
  return chunk => {
    const bytes = [...pending, ...chunk]; pending = [];
    let out = '', i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      const need = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      if (i + need > bytes.length) { pending = bytes.slice(i); break; }
      let cp = need === 1 ? b : b & (0xff >> (need + 1));
      for (let k = 1; k < need; k++) cp = (cp << 6) | (bytes[i + k] & 0x3f);
      out += String.fromCodePoint(cp); i += need;
    }
    return out;
  };
}

/**
 * Send a chat message and stream the answer.
 * handlers: { onMeta({conversationId}), onText(delta), onDone(data), onError(message, partial) }
 */
export async function streamChat(payload, handlers, signal) {
  const res = await streamingFetch(API_URL + '/api/chat', {
    method: 'POST', headers: await headers(), body: JSON.stringify(payload), signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not reach the assistant.');
  }
  const reader = res.body.getReader();
  const decode = makeDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decode(value);
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      let event = 'message', data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      let d; try { d = JSON.parse(data); } catch { continue; }
      if (event === 'meta') handlers.onMeta?.(d);
      else if (event === 'text') handlers.onText?.(d.delta);
      else if (event === 'done') handlers.onDone?.(d);
      else if (event === 'error') handlers.onError?.(d.error, d.partial);
    }
  }
}
