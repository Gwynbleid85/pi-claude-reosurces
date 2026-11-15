import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// Tests can use either npm-installed development dependencies or an existing Pi installation.
const entry = process.env.PI_TEST_HOST_ENTRY
  ? pathToFileURL(process.env.PI_TEST_HOST_ENTRY).href
  : import.meta.resolve('@earendil-works/pi-coding-agent');
export const piBase = new URL('./', entry);

// Mirror Pi's host-package alias using the real API, not a test stub.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@earendil-works/pi-coding-agent') {
      return { url: entry, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
