// Test doubles, published as `@nova/core/testing` so they stay out of app bundles.
export { defaultChunkResult, FakeSTT } from './fake-stt';
export type { FakeSttStep } from './fake-stt';
export { FAKE_LLM_USAGE, FakeLLM } from './fake-llm';
export type { FakeLlmStep } from './fake-llm';
export { FakeAudioSource } from './fake-audio-source';
export { concatPcm, silence, speechPattern, tone } from './signals';
