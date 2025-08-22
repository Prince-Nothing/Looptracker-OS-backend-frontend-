export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  properties?: Record<string, any>;
};

export type Diagnostics = {
  MIIS?: number;
  SRQ?: number;
  EFM?: number;
};

export type DiagnosticPoint = {
  timestamp: string;
  diagnostics: {
    MIIS?: number;
    SRQ?: number;
    EFM?: number;
    [k: string]: number | undefined;
  };
};

export type Series = { MIIS: number[]; SRQ: number[]; EFM: number[] };
