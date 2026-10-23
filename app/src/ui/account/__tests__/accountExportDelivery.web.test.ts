import { Blob as NodeBlob } from 'node:buffer';
import { deliverAccountExport } from '../accountExportDelivery.web';
it('hands exact JSON bytes to a browser download and releases its object URL', async () => {
 const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'); const oldBlob = globalThis.Blob;
 const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
 const anchor = { href: '', download: '', click: jest.fn(), remove: jest.fn() };
 let delivered: Blob | undefined; const revoke = jest.fn();
 jest.useFakeTimers();
 try {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => anchor, body: { appendChild: jest.fn() } } });
  globalThis.Blob = NodeBlob as unknown as typeof Blob;
  URL.createObjectURL = jest.fn((blob: Blob) => { delivered = blob; return 'blob:fixture-export'; }); URL.revokeObjectURL = revoke;
  const json = '{\n  "own": "server bytes"\n}';
  expect(await deliverAccountExport({ accountId: '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01', json })).toBe('download-started');
  expect(await delivered?.text()).toBe(json); expect(delivered?.type).toMatch(/^application\/json/); expect(anchor.download).toMatch(/\.json$/); expect(anchor.href).toBe('blob:fixture-export'); expect(anchor.click).toHaveBeenCalledTimes(1);
  jest.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:fixture-export');
 } finally {
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
  globalThis.Blob = oldBlob; URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; jest.useRealTimers();
 }
});
