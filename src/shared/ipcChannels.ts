// Single source of truth for IPC channel names — imported by main and preload only.
// Renderer never invokes these strings directly; it only calls window.ponyabc.* methods.
export const IPC = {
  registrationOpen: 'ponyabc:registration:open',

  penRootScan: 'ponyabc:penRoot:scan',
  penRootChooseCandidate: 'ponyabc:penRoot:chooseCandidate',
  penRootSelect: 'ponyabc:penRoot:select',
  penRootVolumesChanged: 'ponyabc:penRoot:volumes-changed',
  recordingsList: 'ponyabc:recordings:list',

  computerFolderSelect: 'ponyabc:computerFolder:select',
  computerFolderRestore: 'ponyabc:computerFolder:restore',
  computerFolderList: 'ponyabc:computerFolder:list',

  copyToComputer: 'ponyabc:transfer:toComputer',

  transferToPenPlan: 'ponyabc:transfer:toPen:plan',
  transferToPenExecute: 'ponyabc:transfer:toPen:execute',

  replaceStickerPlan: 'ponyabc:transfer:replaceSticker:plan',
  replaceStickerExecute: 'ponyabc:transfer:replaceSticker:execute',

  transferProgress: 'ponyabc:transfer:progress',

  settingsGet: 'ponyabc:settings:get',
  settingsSet: 'ponyabc:settings:set',

  appInfoGet: 'ponyabc:app:info',
} as const;
