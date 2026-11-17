import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Speech from 'expo-speech';
import {
  useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, createAudioPlayer,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { api, streamChat } from './src/api';
import Markdown from './src/Markdown';

const GREEN = '#2f6b3f';
const STARTERS = [
  'How do I prepare Jeevamrutham for one acre?',
  'My tomato leaves are curling and turning yellow. What can I do?',
  'How can I increase organic carbon in my soil?',
  'What is mulching and how do I do it?',
];
const STAGES = ['Just starting / curious', 'Converting from chemical farming', '1–3 years natural farming', 'More than 3 years'];
let keySeq = 0;
const newKey = () => `m${Date.now()}_${keySeq++}`;

export default function App() {
  return (
    <SafeAreaProvider>
      <ChatScreen />
    </SafeAreaProvider>
  );
}

function ChatScreen() {
  const [config, setConfig] = useState({ botName: 'Krishi Saathi', languages: [], voiceInput: false });
  const [lang, setLang] = useState('auto');
  const [convId, setConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);           // [{uri, base64}]
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingKey, setSpeakingKey] = useState(null);
  const [modal, setModal] = useState(null);           // 'lang' | 'history' | 'profile'
  const [offline, setOffline] = useState(false);
  const listRef = useRef(null);
  const ctlRef = useRef(null);
  const playerRef = useRef(null);
  const recTimer = useRef(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  /* ---------- start-up ---------- */
  useEffect(() => {
    (async () => {
      const savedLang = await AsyncStorage.getItem('ks_lang');
      if (savedLang) setLang(savedLang);
      try { setConfig(await api('/api/config')); setOffline(false); } catch { setOffline(true); }
      const savedConv = await AsyncStorage.getItem('ks_conv');
      if (savedConv) loadConversation(savedConv);
    })();
    return () => { Speech.stop(); playerRef.current?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
  const patch = (key, fields) => setMessages(ms => ms.map(m => (m.key === key ? { ...m, ...fields } : m)));

  /* ---------- conversations ---------- */
  const loadConversation = useCallback(async id => {
    try {
      const c = await api(`/api/conversations/${id}`);
      setConvId(c.id); AsyncStorage.setItem('ks_conv', c.id);
      setMessages(c.messages.map(m => ({ key: newKey(), id: m.id, role: m.role, content: m.content, lang: m.lang, rating: m.rating, imageCount: m.image_count })));
      const last = c.messages[c.messages.length - 1];
      setSuggestions(last?.role === 'assistant' ? (last.suggestions || []) : []);
      scrollToEnd();
    } catch {
      setConvId(null); AsyncStorage.removeItem('ks_conv');
    }
  }, []);

  const newChat = () => {
    ctlRef.current?.abort();
    setConvId(null); AsyncStorage.removeItem('ks_conv');
    setMessages([]); setSuggestions([]); setInput(''); setImages([]);
  };

  /* ---------- send ---------- */
  const send = async text => {
    const t = (text ?? input).trim();
    if (busy || (!t && !images.length)) return;
    const imgs = images;
    setInput(''); setImages([]); setSuggestions([]);
    const userKey = newKey(), botKey = newKey();
    setMessages(ms => [...ms,
      { key: userKey, role: 'user', content: t || '📷', images: imgs.map(i => i.uri) },
      { key: botKey, role: 'assistant', content: '', streaming: true }]);
    scrollToEnd();
    setBusy(true);
    const ctl = new AbortController(); ctlRef.current = ctl;
    let shown = '', finished = false;
    try {
      await streamChat(
        { conversationId: convId, message: t, language: lang, images: imgs.map(i => ({ mediaType: 'image/jpeg', data: i.base64 })) },
        {
          onMeta: d => { if (d.conversationId) { setConvId(d.conversationId); AsyncStorage.setItem('ks_conv', d.conversationId); } },
          onText: delta => { shown += delta; patch(botKey, { content: shown }); scrollToEnd(); },
          onDone: d => {
            finished = true;
            patch(botKey, { content: d.content, id: d.messageId, lang: d.lang, streaming: false });
            setSuggestions(d.suggestions || []);
          },
          onError: (msg, partial) => { finished = true; patch(botKey, { content: partial || shown, error: msg, streaming: false }); },
        },
        ctl.signal,
      );
      if (!finished) patch(botKey, { streaming: false, error: shown ? null : 'No reply. Please try again.' });
    } catch (e) {
      const stopped = e?.name === 'AbortError' || ctl.signal.aborted;
      patch(botKey, { content: shown, streaming: false, error: stopped ? 'Stopped.' : (e.message || 'Network problem. Please try again.') });
    } finally {
      if (ctlRef.current === ctl) ctlRef.current = null;
      setBusy(false); scrollToEnd();
    }
  };

  /* ---------- feedback ---------- */
  const rate = async (m, rating) => {
    if (!m.id || m.rating) return;
    patch(m.key, { rating });
    api(`/api/messages/${m.id}/rating`, { method: 'POST', body: { rating } }).catch(() => {});
  };

  /* ---------- photos ---------- */
  const preparePhoto = async asset => {
    let ctx = ImageManipulator.manipulate(asset.uri);
    if ((asset.width || 0) > 1280) ctx = ctx.resize({ width: 1280 });
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ base64: true, compress: 0.75, format: SaveFormat.JPEG });
    return { uri: out.uri, base64: out.base64 };
  };
  const pickPhoto = () => {
    if (images.length >= 4) { Alert.alert('Up to 4 photos per message'); return; }
    Alert.alert('Add a crop photo', 'Take a clear, close photo of the affected leaf, fruit or soil.', [
      { text: 'Camera', onPress: async () => {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('Camera permission is needed to take a photo.'); return; }
        const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
        if (!r.canceled && r.assets?.[0]) { const p = await preparePhoto(r.assets[0]); setImages(x => [...x, p].slice(0, 4)); }
      } },
      { text: 'Gallery', onPress: async () => {
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsMultipleSelection: true, selectionLimit: 4 - images.length });
        if (!r.canceled && r.assets?.length) {
          const prepared = await Promise.all(r.assets.slice(0, 4 - images.length).map(preparePhoto));
          setImages(x => [...x, ...prepared].slice(0, 4));
        }
      } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /* ---------- voice input ---------- */
  const stopRecording = async () => {
    clearTimeout(recTimer.current);
    setRecording(false);
    try { await recorder.stop(); } catch { /* already stopped */ }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri;
    if (!uri) return;
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append('audio', { uri, name: 'voice.m4a', type: 'audio/m4a' });
      form.append('language', lang);
      const r = await api('/api/transcribe', { method: 'POST', form });
      if (r.text) setInput(v => (v ? `${v} ${r.text}` : r.text));
    } catch {
      Alert.alert('Could not understand', 'Please try speaking again, or type your question.');
    } finally { setTranscribing(false); }
  };
  const toggleMic = async () => {
    if (recording) { stopRecording(); return; }
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) { Alert.alert('Microphone permission is needed for voice questions.'); return; }
    Speech.stop();
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
    recTimer.current = setTimeout(stopRecording, 28000); // speech API works best under 30 s
  };

  /* ---------- read aloud ---------- */
  const stopSpeaking = () => {
    Speech.stop();
    if (playerRef.current) { playerRef.current.remove(); playerRef.current = null; }
    setSpeakingKey(null);
  };
  const speak = async m => {
    if (speakingKey === m.key) { stopSpeaking(); return; }
    stopSpeaking();
    setSpeakingKey(m.key);
    const code = m.lang || (lang !== 'auto' ? lang : 'en');
    const L = config.languages.find(l => l.code === code);
    if (L?.serverTts) {
      try {
        const r = await api('/api/tts', { method: 'POST', body: { text: m.content, language: code } });
        const file = new File(Paths.cache, `tts-${Date.now()}.mp3`);
        await file.write(r.audio, { encoding: 'base64' });
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        const player = createAudioPlayer(file.uri);
        playerRef.current = player;
        player.addListener('playbackStatusUpdate', s => { if (s.didJustFinish) { player.remove(); if (playerRef.current === player) playerRef.current = null; setSpeakingKey(k => (k === m.key ? null : k)); } });
        player.play();
        return;
      } catch { /* fall back to the phone's own voice */ }
    }
    Speech.speak(m.content.replace(/[*#_`>]/g, ''), {
      language: code === 'en' ? 'en-IN' : `${code}-IN`,
      onDone: () => setSpeakingKey(null), onStopped: () => setSpeakingKey(null), onError: () => setSpeakingKey(null),
    });
  };

  /* ---------- rendering ---------- */
  const langLabel = lang === 'auto' ? 'Auto 🌐' : (config.languages.find(l => l.code === lang)?.native || lang);

  const renderItem = ({ item: m }) => {
    if (m.role === 'user') {
      return (
        <View style={[s.row, s.rowUser]}>
          <View style={[s.bubble, s.userBubble]}>
            {!!m.images?.length && <View style={s.thumbRow}>{m.images.map((u, i) => <Image key={i} source={{ uri: u }} style={s.thumb} />)}</View>}
            <Text style={s.userText}>{m.content}{m.imageCount ? `  📷×${m.imageCount}` : ''}</Text>
          </View>
        </View>
      );
    }
    return (
      <View style={s.row}>
        <View style={[s.bubble, s.botBubble]}>
          {m.streaming && !m.content ? <View style={s.thinking}><ActivityIndicator color={GREEN} /><Text style={s.muted}>  Thinking…</Text></View>
            : <Markdown text={m.content} />}
          {!!m.error && <Text style={[s.note, m.error !== 'Stopped.' && s.err]}>{m.error}</Text>}
          {!m.streaming && !!m.content && (
            <View style={s.actions}>
              <Chip label={speakingKey === m.key ? '⏹ Stop' : '🔊 Listen'} onPress={() => speak(m)} on={speakingKey === m.key} />
              {!!m.id && <Chip label="👍" onPress={() => rate(m, 1)} on={m.rating === 1} disabled={!!m.rating} />}
              {!!m.id && <Chip label="👎" onPress={() => rate(m, -1)} on={m.rating === -1} disabled={!!m.rating} />}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{config.botName}</Text>
          <Text style={s.subtitle}>Natural farming help · any language</Text>
        </View>
        <HeaderBtn label={langLabel} onPress={() => setModal('lang')} wide />
        <HeaderBtn label="🕘" onPress={() => setModal('history')} />
        <HeaderBtn label="🏡" onPress={() => setModal('profile')} />
        <HeaderBtn label="＋" onPress={newChat} />
      </View>
      {offline && <Text style={s.offline}>Can't reach the server. Check your internet connection.</Text>}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {messages.length === 0 ? (
          <ScrollView contentContainerStyle={s.welcome}>
            <Text style={s.wTitle}>Vanakkam · Namaste 🙏</Text>
            <Text style={s.wSub}>Ask me about natural farming in your own language — type, speak, or send a crop photo.</Text>
            {STARTERS.map(q => <Pressable key={q} style={s.starter} onPress={() => send(q)}><Text style={s.starterText}>{q}</Text></Pressable>)}
          </ScrollView>
        ) : (
          <FlatList ref={listRef} data={messages} keyExtractor={m => m.key} renderItem={renderItem}
            contentContainerStyle={s.list} onContentSizeChange={scrollToEnd} keyboardShouldPersistTaps="handled" />
        )}

        {suggestions.length > 0 && !busy && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.sugBar} contentContainerStyle={s.sugRow} keyboardShouldPersistTaps="handled">
            {suggestions.map(q => <Pressable key={q} style={s.sug} onPress={() => send(q)}><Text style={s.sugText}>{q}</Text></Pressable>)}
          </ScrollView>
        )}

        <View style={s.composer}>
          {images.length > 0 && (
            <View style={s.pendRow}>
              {images.map((im, i) => (
                <Pressable key={i} onPress={() => setImages(x => x.filter((_, j) => j !== i))}>
                  <Image source={{ uri: im.uri }} style={s.pend} /><Text style={s.pendX}>✕</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={s.inputRow}>
            <IconBtn label="📷" onPress={pickPhoto} />
            <TextInput style={s.input} value={input} onChangeText={setInput} multiline
              placeholder={recording ? 'Listening… tap ■ to finish' : transcribing ? 'Understanding your voice…' : 'Ask in any Indian language…'}
              placeholderTextColor="#8a8f86" />
            {config.voiceInput && <IconBtn label={recording ? '■' : '🎤'} onPress={toggleMic} danger={recording} />}
            <IconBtn label={busy ? '■' : '➤'} primary onPress={() => (busy ? ctlRef.current?.abort() : send())} />
          </View>
          <Text style={s.disclaimer}>AI answers may be imperfect — check important steps with your field coordinator.</Text>
        </View>
      </KeyboardAvoidingView>

      <LanguageModal visible={modal === 'lang'} languages={config.languages} value={lang}
        onClose={() => setModal(null)}
        onPick={code => { setLang(code); AsyncStorage.setItem('ks_lang', code); setModal(null); }} />
      <HistoryModal visible={modal === 'history'} onClose={() => setModal(null)}
        onOpen={id => { setModal(null); loadConversation(id); }} onDeleted={id => { if (id === convId) newChat(); }} />
      <ProfileModal visible={modal === 'profile'} lang={lang} onClose={() => setModal(null)} />
    </SafeAreaView>
  );
}

/* ---------- small components ---------- */
function HeaderBtn({ label, onPress, wide }) {
  return <Pressable onPress={onPress} style={[s.hBtn, wide && s.hBtnWide]} hitSlop={6}><Text style={s.hBtnText} numberOfLines={1}>{label}</Text></Pressable>;
}
function IconBtn({ label, onPress, primary, danger }) {
  return <Pressable onPress={onPress} style={[s.iBtn, primary && s.iBtnPrimary, danger && s.iBtnDanger]} hitSlop={4}><Text style={[s.iBtnText, (primary || danger) && { color: '#fff' }]}>{label}</Text></Pressable>;
}
function Chip({ label, onPress, on, disabled }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[s.chip, on && s.chipOn]}><Text style={[s.chipText, on && { color: GREEN }]}>{label}</Text></Pressable>;
}

function Sheet({ visible, title, onClose, children }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.sheetBg}>
        <View style={s.sheet}>
          <View style={s.sheetHead}><Text style={s.sheetTitle}>{title}</Text><Pressable onPress={onClose} hitSlop={10}><Text style={s.close}>✕</Text></Pressable></View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function LanguageModal({ visible, languages, value, onPick, onClose }) {
  const data = [{ code: 'auto', name: 'Match the farmer automatically', native: 'Auto 🌐' }, ...languages];
  return (
    <Sheet visible={visible} title="Reply language" onClose={onClose}>
      <FlatList data={data} keyExtractor={l => l.code} renderItem={({ item: l }) => (
        <Pressable style={[s.langRow, value === l.code && s.langRowOn]} onPress={() => onPick(l.code)}>
          <Text style={s.langNative}>{l.native}</Text><Text style={s.muted}>{l.name}</Text>
        </Pressable>
      )} />
    </Sheet>
  );
}

function HistoryModal({ visible, onOpen, onClose, onDeleted }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!visible) return;
    setRows(null);
    api('/api/conversations').then(setRows).catch(() => setRows([]));
  }, [visible]);
  const del = id => Alert.alert('Delete this chat?', '', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      await api(`/api/conversations/${id}`, { method: 'DELETE' }).catch(() => {});
      setRows(r => r.filter(x => x.id !== id)); onDeleted(id);
    } },
  ]);
  return (
    <Sheet visible={visible} title="Past chats" onClose={onClose}>
      {rows === null ? <ActivityIndicator color={GREEN} style={{ margin: 24 }} /> : rows.length === 0 ? <Text style={[s.muted, { padding: 16 }]}>No past chats yet.</Text> : (
        <FlatList data={rows} keyExtractor={c => c.id} renderItem={({ item: c }) => (
          <Pressable style={s.histRow} onPress={() => onOpen(c.id)} onLongPress={() => del(c.id)}>
            <Text style={s.histTitle} numberOfLines={1}>{c.title || 'Chat'}</Text>
            <Text style={s.muted}>{new Date(c.updated_at).toLocaleDateString()}</Text>
          </Pressable>
        )} ListFooterComponent={<Text style={[s.muted, { padding: 12, fontSize: 12 }]}>Long-press a chat to delete it.</Text>} />
      )}
    </Sheet>
  );
}

function ProfileModal({ visible, lang, onClose }) {
  const [p, setP] = useState({ region: '', crops: '', land: '', stage: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!visible) return;
    api('/api/profile').then(d => setP({ region: d.region || '', crops: d.crops || '', land: d.land || '', stage: d.stage || '' })).catch(() => {});
  }, [visible]);
  const save = async () => {
    setSaving(true);
    try { await api('/api/profile', { method: 'PUT', body: { ...p, language: lang } }); onClose(); }
    catch { Alert.alert('Could not save. Please try again.'); }
    finally { setSaving(false); }
  };
  const field = (key, label, placeholder) => (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.field} value={p[key]} onChangeText={v => setP(x => ({ ...x, [key]: v }))} placeholder={placeholder} placeholderTextColor="#9aa29a" />
    </View>
  );
  return (
    <Sheet visible={visible} title="My farm" onClose={onClose}>
      <ScrollView style={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={[s.muted, { marginBottom: 12 }]}>Optional. Helps the assistant give advice for your area and crops.</Text>
        {field('region', 'Village / district / state', 'e.g. Thanjavur, Tamil Nadu')}
        {field('crops', 'Main crops', 'e.g. paddy, banana, coconut')}
        {field('land', 'Land size', 'e.g. 2 acres')}
        <Text style={s.label}>Natural farming experience</Text>
        <View style={s.stageWrap}>
          {STAGES.map(st => <Chip key={st} label={st} on={p.stage === st} onPress={() => setP(x => ({ ...x, stage: x.stage === st ? '' : st }))} />)}
        </View>
        <Pressable style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}><Text style={s.saveText}>{saving ? 'Saving…' : 'Save'}</Text></Pressable>
        <View style={{ height: 40 }} />
      </ScrollView>
    </Sheet>
  );
}

/* ---------- styles ---------- */
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GREEN },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: GREEN },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,.85)', fontSize: 12 },
  hBtn: { backgroundColor: 'rgba(255,255,255,.16)', borderRadius: 10, minWidth: 36, height: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  hBtnWide: { maxWidth: 110, paddingHorizontal: 10 },
  hBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  offline: { backgroundColor: '#f3e6d3', color: '#8a5a2b', padding: 8, textAlign: 'center', fontSize: 13 },
  list: { padding: 12, paddingBottom: 4, backgroundColor: '#f5f1e7', flexGrow: 1 },
  welcome: { padding: 20, backgroundColor: '#f5f1e7', flexGrow: 1 },
  wTitle: { fontSize: 24, fontWeight: '700', color: '#1d2a20', textAlign: 'center', marginTop: 16 },
  wSub: { fontSize: 15, color: '#5d6a5e', textAlign: 'center', marginVertical: 12, lineHeight: 21 },
  starter: { backgroundColor: '#fffdf8', borderWidth: 1, borderColor: '#e2dac8', borderRadius: 14, padding: 14, marginTop: 8 },
  starterText: { fontSize: 15, color: '#1d2a20' },
  row: { flexDirection: 'row', marginBottom: 10 },
  rowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10 },
  userBubble: { backgroundColor: GREEN, borderBottomRightRadius: 4 },
  botBubble: { backgroundColor: '#fffdf8', borderWidth: 1, borderColor: '#e2dac8', borderBottomLeftRadius: 4 },
  userText: { color: '#fff', fontSize: 16, lineHeight: 22 },
  thumbRow: { flexDirection: 'row', gap: 4, marginBottom: 6 },
  thumb: { width: 70, height: 70, borderRadius: 8 },
  thinking: { flexDirection: 'row', alignItems: 'center' },
  muted: { color: '#5d6a5e', fontSize: 14 },
  note: { color: '#5d6a5e', fontSize: 13, marginTop: 6 },
  err: { color: '#b3412e' },
  actions: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: '#e2dac8', backgroundColor: '#f5f1e7', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { backgroundColor: '#e3eee0', borderColor: GREEN },
  chipText: { fontSize: 13, color: '#5d6a5e' },
  sugBar: { backgroundColor: '#f5f1e7', flexGrow: 0 },
  sugRow: { paddingHorizontal: 10, paddingVertical: 6, gap: 6 },
  sug: { borderWidth: 1, borderColor: '#9bbca3', backgroundColor: '#fffdf8', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7 },
  sugText: { color: GREEN, fontSize: 14 },
  composer: { backgroundColor: '#fffdf8', borderTopWidth: 1, borderColor: '#e2dac8', padding: 8 },
  pendRow: { flexDirection: 'row', gap: 8, paddingBottom: 6 },
  pend: { width: 52, height: 52, borderRadius: 8 },
  pendX: { position: 'absolute', top: -4, right: -4, backgroundColor: '#1d2a20', color: '#fff', borderRadius: 9, width: 18, height: 18, textAlign: 'center', fontSize: 11, lineHeight: 18, overflow: 'hidden' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  input: { flex: 1, minHeight: 42, maxHeight: 120, fontSize: 16, paddingHorizontal: 8, paddingVertical: 10, color: '#1d2a20' },
  iBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iBtnPrimary: { backgroundColor: GREEN },
  iBtnDanger: { backgroundColor: '#b3412e' },
  iBtnText: { fontSize: 20, color: '#5d6a5e' },
  disclaimer: { fontSize: 10.5, color: '#8a8f86', textAlign: 'center', marginTop: 2 },
  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fffdf8', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', minHeight: '50%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: '#e2dac8' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#1d2a20' },
  close: { fontSize: 20, color: '#5d6a5e' },
  langRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f0eadc' },
  langRowOn: { backgroundColor: '#e3eee0' },
  langNative: { fontSize: 17, color: '#1d2a20' },
  histRow: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f0eadc' },
  histTitle: { fontSize: 16, color: '#1d2a20', marginBottom: 2 },
  label: { fontWeight: '600', color: '#1d2a20', marginBottom: 6, fontSize: 14 },
  field: { borderWidth: 1, borderColor: '#e2dac8', borderRadius: 10, padding: 10, fontSize: 16, backgroundColor: '#fff', color: '#1d2a20' },
  stageWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  saveBtn: { backgroundColor: GREEN, borderRadius: 12, padding: 14, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
