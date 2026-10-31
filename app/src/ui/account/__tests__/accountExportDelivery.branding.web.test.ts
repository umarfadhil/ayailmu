import { Blob as NodeBlob } from 'node:buffer';
import { deliverAccountExport } from '../accountExportDelivery.web';
// The browser download is named for AyaFasih and carries the snapshot's own bytes untouched. Fictional values only.
it('downloads the original snapshot bytes as ayafasih-data-akun.json with one click, then removes the link and revokes the URL', async () => {
 const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'); const oldBlob = globalThis.Blob;
 const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
 const anchor = { href: '', download: '', click: jest.fn(), remove: jest.fn() };
 const appendChild = jest.fn(); const revoke = jest.fn(); const sent: { blob?: Blob } = {};
 jest.useFakeTimers();
 try {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => anchor, body: { appendChild } } });
  globalThis.Blob = NodeBlob as unknown as typeof Blob;
  const create = jest.fn((blob: Blob) => { sent.blob = blob; return 'blob:fictional-export'; });
  URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  const json = '{\n  "profil": "Ani Fiktif",\n  "catatan": "jawaban — café ✓",\n  "jumlah": 3\n}\n';
  expect(await deliverAccountExport({ accountId: '00000000-0000-4000-8000-000000000117', json })).toBe('download-started');
  expect(anchor.download).toBe('ayafasih-data-akun.json');
  expect(sent.blob).toBeDefined();
  expect(Buffer.from(await (sent.blob as Blob).arrayBuffer()).toString('hex')).toBe(Buffer.from(json, 'utf8').toString('hex'));
  expect(sent.blob?.type).toMatch(/^application\/json/);
  expect(create).toHaveBeenCalledTimes(1); expect(anchor.href).toBe('blob:fictional-export');
  expect(appendChild).toHaveBeenCalledWith(anchor); expect(anchor.click).toHaveBeenCalledTimes(1); expect(anchor.remove).toHaveBeenCalledTimes(1);
  jest.runAllTimers(); expect(revoke).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledWith('blob:fictional-export');
 } finally {
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
  globalThis.Blob = oldBlob; URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; jest.useRealTimers();
 }
});
