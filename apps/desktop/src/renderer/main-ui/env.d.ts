import type { NovaApi } from '../../preload/api';

declare global {
  interface Window {
    readonly nova: NovaApi;
  }
}
