// Texts of the page in Indonesian (decision 028). Names of events, enums and ids stay English.
export const ID = {
  'app.title': 'Kafe Virtual',
  'status.connecting': 'Menyambung ke server...',
  'status.open': 'Tersambung',
  'status.closed': 'Terputus, mencoba lagi...',
  'clock.day': 'Hari',
  'clock.speed': 'kecepatan',
  'clock.paused': 'JEDA',
} as const;

export type TextKey = keyof typeof ID;
