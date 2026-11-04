import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'chat-keyboard-tests-'));
after(() => rm(temporary, { recursive: true, force: true }));
let bundleId = 0;

async function setup(t, { offset = 0, nativeListInsets = true } = {}) {
  const h = globalThis.chatKeyboardHarness = {
    offset: { value: offset }, reactions: [], frames: [], scrolls: [], handlers: [],
    nativeInset: 0, modes: [], renders: 0,
  };
  const mocks = {
    'react-native': `export const Platform = { OS: 'android' };
      export const StyleSheet = { create: value => value };
      export const ScrollView = 'scroll';`,
    'react-native-safe-area-context': 'export const useSafeAreaInsets = () => ({ bottom: 24 });',
    'react-native-keyboard-controller': `export const ClippingScrollView = 'inset';
      export const AndroidSoftInputModes = { SOFT_INPUT_ADJUST_NOTHING: 48 };
      export const KeyboardController = {
        setInputMode: value => globalThis.chatKeyboardHarness.modes.push(value),
        setDefaultMode() {}, dismiss() {},
      };
      export function useGenericKeyboardHandler(handler) {
        globalThis.chatKeyboardHarness.handlers[0] = handler;
      }`,
    'react-native-reanimated': `import React from 'react';
      export const useSharedValue = value => React.useRef({ value }).current;
      export const useDerivedValue = worklet => React.useMemo(() => ({ get value() { return worklet(); } }), []);
      export const useAnimatedStyle = worklet => ({ read: worklet });
      export const useAnimatedProps = worklet => ({ read: worklet });
      export const useAnimatedRef = () => React.useMemo(() => {
        let node;
        return function ref(value) { if (arguments.length) node = value; return node; };
      }, []);
      export const useScrollOffset = () => globalThis.chatKeyboardHarness.offset;
      export const useAnimatedReaction = (read, react) => {
        React.useEffect(() => {
          const subscription = { read, react, previous: null };
          const list = globalThis.chatKeyboardHarness.reactions;
          list.push(subscription);
          return () => list.splice(list.indexOf(subscription), 1);
        }, []);
      };
      export const scrollTo = (ref, x, y, animated) => {
        if (!ref()) throw new Error('scroll after unmount');
        globalThis.chatKeyboardHarness.scrolls.push({ y, animated });
        globalThis.chatKeyboardHarness.offset.value = y;
      };
      export const runOnUI = worklet => worklet;
      export const runOnJS = callback => callback;
      export const cancelAnimation = () => {};
      export const withTiming = (value, config, done) => { done?.(true); return value; };
      export const Easing = { out: value => value, cubic: value => value };
      export default { ScrollView: 'scroll', createAnimatedComponent: component => component };`,
  };
  const result = await build({
    stdin: { contents: `export { useChatImeLayout } from './hooks/useChatImeLayout';
      export { ChatScrollView } from './components/chat/ChatScrollView.android';`, resolveDir: root },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'native-boundary', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: require.resolve('react'), external: true }));
      builder.onResolve({ filter: /^react-native/ }, ({ path }) => ({ path, namespace: 'native' }));
      builder.onLoad({ filter: /.*/, namespace: 'native' }, ({ path }) => ({ contents: mocks[path] }));
    } }],
  });
  const output = join(temporary, `${bundleId++}.mjs`);
  await writeFile(output, result.outputFiles[0].text);
  const { useChatImeLayout, ChatScrollView } = await import(pathToFileURL(output).href);
  let layout;
  let view;
  let enabled = true;
  function Probe() {
    h.renders += 1;
    layout = useChatImeLayout(enabled, { nativeListInsets });
    return React.createElement(ChatScrollView, {
      bottomInset: layout.listInset, transition: layout.listTransition, followThreshold: 80,
    });
  }
  const previousRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => h.frames.push(callback);
  await act(async () => { view = create(React.createElement(Probe), { createNodeMock: () => ({}) }); });
  t.after(async () => {
    await act(async () => view.unmount());
    globalThis.requestAnimationFrame = previousRAF;
  });
  h.frame = () => {
    for (const subscription of h.reactions) {
      const current = subscription.read();
      subscription.react(current, subscription.previous);
      subscription.previous = current;
    }
    // Native ClippingScrollView compensates its top translation by scrolling
    // by the inset delta. This models that native boundary, not Yoga layout.
    const inset = view.root.findByType('inset').props.animatedProps.read().contentInsetTop;
    h.offset.value = Math.max(0, h.offset.value + inset - h.nativeInset);
    h.nativeInset = inset;
    const callbacks = h.frames.splice(0);
    callbacks.forEach(callback => callback());
  };
  h.event = async (name, height) => {
    await act(async () => { h.handlers[0][name]({ height, progress: height ? 1 : 0 }); });
    h.frame();
  };
  h.layout = () => layout;
  h.drag = () => view.root.findByType('scroll').props.onScrollBeginDrag({ nativeEvent: {} });
  h.disable = async () => { enabled = false; await act(async () => view.update(React.createElement(Probe))); h.frame(); };
  h.frame();
  layout.onComposerStackLayout({ nativeEvent: { layout: { height: 50 } } });
  return h;
}

test('keyboard frames lift latest messages without resizing the list or rerendering React', async t => {
  const h = await setup(t);
  const initialHeight = h.layout().listSpacerStyle.read().height;
  const renders = h.renders;
  await h.event('onStart', 324);
  for (const height of [50, 110, 190, 260, 324]) {
    await h.event('onMove', height);
    assert.equal(h.offset.value, 0);
    assert.equal(h.layout().listSpacerStyle.read().height, initialHeight);
    assert.equal(h.layout().dockStyle.read().transform[0].translateY, -Math.max(0, height - 24));
  }
  assert.equal(h.renders, renders);
  assert.ok(h.scrolls.every(call => call.animated === false));
});

test('reading history preserves the visible anchor through keyboard open and close', async t => {
  const h = await setup(t, { offset: 500 });
  await h.event('onStart', 324);
  for (const height of [75, 160, 240, 324]) {
    await h.event('onMove', height);
    assert.equal(h.offset.value - h.nativeInset, 500);
  }
  await h.event('onEnd', 324);
  await h.event('onStart', 0);
  for (const height of [240, 160, 75, 0]) {
    await h.event('onMove', height);
    assert.equal(h.offset.value - h.nativeInset, 500);
  }
  assert.equal(h.scrolls.length, 0);
});

test('scrolling into history with the keyboard up does not pull messages down on dismiss', async t => {
  const h = await setup(t);
  await h.event('onStart', 324);
  await h.event('onMove', 324);
  await h.event('onEnd', 324);
  h.offset.value = 800;
  const scrolls = h.scrolls.length;
  await h.event('onStart', 0);
  await h.event('onMove', 0);
  assert.equal(h.offset.value, 500);
  assert.equal(h.scrolls.length, scrolls);
});

test('emoji and keyboard trade a single native inset without doubling or collapsing it', async t => {
  const h = await setup(t);
  await h.event('onStart', 324);
  await h.event('onMove', 324);
  await h.event('onEnd', 324);
  await act(async () => h.layout().openEmojiPanel());
  h.frame();
  await h.event('onStart', 0);
  for (const height of [200, 90, 0]) {
    await h.event('onMove', height);
    assert.equal(h.nativeInset, 300);
  }
  await h.event('onEnd', 0);
  await act(async () => h.layout().requestKeyboard());
  await h.event('onStart', 324);
  for (const height of [90, 200, 324]) {
    await h.event('onMove', height);
    assert.equal(h.nativeInset, 300);
  }
  await h.event('onEnd', 324);
  assert.equal(h.nativeInset, 300);
  assert.equal(h.offset.value, 0);
});

test('dragging cancels queued keyboard following', async t => {
  const h = await setup(t);
  h.scrolls.length = 0;
  await h.event('onStart', 324);
  h.drag();
  await h.event('onMove', 150);
  assert.equal(h.scrolls.length, 0);
});

test('other shared-hook consumers keep their existing resize behavior', async t => {
  const h = await setup(t, { nativeListInsets: false });
  const base = h.layout().listSpacerStyle.read().height;
  await h.event('onMove', 324);
  assert.equal(h.layout().listSpacerStyle.read().height, base + 300);
});

test('leaving a chat resets the dock inset', async t => {
  const h = await setup(t);
  await h.event('onMove', 324);
  await h.disable();
  assert.equal(h.nativeInset, 0);
});
