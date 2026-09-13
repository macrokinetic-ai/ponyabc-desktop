// Single source of truth for IPC channel names — imported by main and preload only.
// Renderer never invokes these strings directly; it only calls window.ponyabc.* methods.
export const IPC = {
  registrationOpen: 'ponyabc:registration:open',
  penRootSelect: 'ponyabc:penRoot:select',
  penRootRestore: 'ponyabc:penRoot:restore',
  recordingsList: 'ponyabc:recordings:list',
  recordingsChooseDestination: 'ponyabc:recordings:chooseDestination',
  recordingsCopy: 'ponyabc:recordings:copy',
  recordingsCopyProgress: 'ponyabc:recordings:copy-progress',
  settingsGet: 'ponyabc:settings:get',
  settingsSet: 'ponyabc:settings:set',
} as const;
