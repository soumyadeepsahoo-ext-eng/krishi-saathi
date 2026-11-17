// Tiny markdown renderer for chat answers: paragraphs, headings, bullet and
// numbered lists, and **bold**. Enough for farmer-friendly answers.
import { Text, View, StyleSheet } from 'react-native';

function Inline({ text, style }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((p, i) => (p.startsWith('**') && p.endsWith('**')
        ? <Text key={i} style={styles.bold}>{p.slice(2, -2)}</Text>
        : <Text key={i}>{p}</Text>))}
    </Text>
  );
}

export default function Markdown({ text, color = '#1d2a20' }) {
  const lines = String(text || '').split('\n');
  const out = [];
  lines.forEach((raw, idx) => {
    const l = raw.trim();
    if (!l) return;
    let m;
    const base = [styles.text, { color }];
    if ((m = l.match(/^#{1,4}\s+(.*)$/))) out.push(<Inline key={idx} text={m[1]} style={[...base, styles.bold, styles.heading]} />);
    else if ((m = l.match(/^[-*•]\s+(.*)$/))) out.push(
      <View key={idx} style={styles.li}><Text style={base}>•  </Text><Inline text={m[1]} style={[...base, styles.flex]} /></View>);
    else if ((m = l.match(/^(\d+)[.)]\s+(.*)$/))) out.push(
      <View key={idx} style={styles.li}><Text style={base}>{m[1]}.  </Text><Inline text={m[2]} style={[...base, styles.flex]} /></View>);
    else out.push(<Inline key={idx} text={l} style={[...base, styles.p]} />);
  });
  return <View>{out}</View>;
}

const styles = StyleSheet.create({
  text: { fontSize: 16, lineHeight: 23 },
  bold: { fontWeight: '700' },
  heading: { marginTop: 4, marginBottom: 2 },
  p: { marginBottom: 6 },
  li: { flexDirection: 'row', marginBottom: 3, paddingRight: 6 },
  flex: { flex: 1 },
});
