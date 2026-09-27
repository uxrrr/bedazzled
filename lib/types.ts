export interface NoteEntry {
  text: string;
  author: string;
  at: string;
}

export interface PhotoRef {
  id: string;
  full: string; // blob id in the photos store
  thumb: string; // blob id in the photos store
  mime: string;
}

export interface Item {
  id: string;
  listNumber: number | null;
  title: string;
  notes: NoteEntry[];
  category: string;
  photos: PhotoRef[];
  coverPhotoId: string | null;
  comps: unknown[]; // phase 2, reserved
  createdAt: string;
  updatedAt: string;
}
