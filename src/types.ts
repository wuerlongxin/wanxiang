import type { ArtStyleId } from './art-styles';

export type GameModeId = 'reflex' | 'memory' | 'strategy' | 'expression' | 'mischief';

export type SceneId = 'lobby' | 'studio' | 'rules' | 'library' | 'exchange' | 'battle';

export interface GameMode {
  id: GameModeId;
  index: string;
  name: string;
  english: string;
  cardName: string;
  tagline: string;
  accent: number;
  accentHex: string;
  accentSoft: number;
  deep: number;
  artwork: string;
  glyph: string;
}

export interface CardData {
  id: string;
  name: string;
  title: string;
  modeId: GameModeId;
  artUrl: string;
  attack: number;
  defense: number;
  cost: number;
  skill: string;
  flavor: string;
  rarity: '普通' | '稀有' | '史诗' | '传说';
  author: string;
  inscriptionStyle?: 'seal' | 'signature';
  inscriptionPlacement?: 'front' | 'back';
  inscriptionText?: string;
  /** Structured gameplay identity compiled from the deck's rule modules. */
  gameplay?: CardGameplayBinding[];
}

export type CardGameplayBinding =
  | {
      kind: 'rapid';
      symbolIds: string[];
      moduleId?: string;
      matchRule?: string;
    }
  | {
      kind: 'memory';
      pairId: string;
      pairRole: 'a' | 'b';
      factionId?: string;
      moduleId?: string;
    }
  | {
      kind: 'quantity';
      categoryId: string;
      value: number;
      targetTotal?: number;
      triggerRelation?: string;
      moduleId?: string;
    }
  | {
      kind: 'expression';
      targetId: string;
      targetCategory: 'animal' | 'object' | 'place' | 'action' | 'emotion';
      moduleId?: string;
    }
  | {
      kind: 'risk';
      cardKind: 'hazard' | 'rescue' | 'action';
      actionKind?: string;
      activationRank?: number;
      moduleId?: string;
    }
  | {
      kind: 'custom';
      moduleId: string;
      slotRole: string;
    };

export interface DeckCompositionPart {
  id: string;
  label: string;
  count: number;
  note?: string;
}

export interface DeckCompositionConstraint {
  id: string;
  label: string;
  description: string;
}

export interface DeckPlaySetup {
  playerRange: { min: number; max: number };
  defaultPlayers: number;
  cardsInPlay: { min: number; max: number; default: number };
  formula: string;
  summary: string;
  auxiliaryComponents: string[];
}

export interface DeckComposition {
  schemaVersion: 1;
  recommendedTotal: number;
  parts: DeckCompositionPart[];
  constraints: DeckCompositionConstraint[];
  rationale: string;
  status: 'sample' | 'incomplete' | 'complete';
  /** Missing on legacy decks; rebuilt from the active rule kit when displayed or exported. */
  playSetup?: DeckPlaySetup;
}

export interface CardBackDesign {
  style: 'forge' | 'constellation' | 'circuit' | 'sigil';
  seed: number;
  label: string;
  textureUrl?: string;
}

export type GameplayMechanicId =
  | 'rapid-match'
  | 'memory-pair'
  | 'quantity-trigger'
  | 'icon-coop'
  | 'risk-draw';

export type RuleParameterValue = string | number | boolean;

export interface RuleParameterChoice {
  value: string;
  label: string;
}

export interface RuleParameter {
  id: string;
  label: string;
  control: 'stepper' | 'toggle' | 'select' | 'text';
  value: RuleParameterValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  choices?: RuleParameterChoice[];
}

export interface RuleVariant {
  id: string;
  name: string;
  description: string;
  enabled?: boolean;
}

export interface RuleModuleContent {
  objective: string[];
  setup: string[];
  flow: string[];
  victory: string[];
  variants: RuleVariant[];
}

export interface GameplayRuleModule {
  id: string;
  source: 'template' | 'custom';
  templateId?: GameplayMechanicId;
  name: string;
  summary: string;
  glyph: string;
  accentHex: string;
  tags: string[];
  enabled: boolean;
  parameters: RuleParameter[];
  content: RuleModuleContent;
}

export interface RuleVictory {
  mode: 'module-default' | 'first-to-points' | 'last-standing' | 'custom';
  target?: number;
  text?: string;
}

export interface RuleKit {
  schemaVersion: 1;
  title: string;
  playerRange: { min: number; max: number };
  durationMinutes: { min: number; max: number };
  ageFrom: number;
  teamMode: boolean;
  components: string[];
  modules: GameplayRuleModule[];
  victory: RuleVictory;
  customNotes: string[];
}

export interface RuleBookStep {
  moduleName: string;
  instruction: string;
}

export interface RuleBook {
  title: string;
  deckName: string;
  world: string;
  deckRules: string[];
  audience: string;
  duration: string;
  objective: string[];
  setup: string[];
  flow: RuleBookStep[];
  victory: string[];
  variants: RuleVariant[];
  components: string[];
  quickReference: string[];
  notes: string[];
}

export interface CreatorPlaque {
  displayName: string;
  studioName?: string;
  signatureText?: string;
  sealText?: string;
  edition?: string;
  serialNumber?: string;
  dedication?: string;
}

export type DeckRevisionReason =
  | 'initial'
  | 'deck-generation'
  | 'card-regeneration'
  | 'manual-snapshot'
  | 'imported';

export interface DeckRevision {
  familyId: string;
  revision: number;
  createdAt: number;
  reason: DeckRevisionReason;
}

export interface DeckRevisionReference {
  familyId: string;
  revision: number;
}

export type DeckCreationMode = 'original' | 'fan-study';

export interface FanStudyConfirmations {
  materialsRightsConfirmed: boolean;
  personalNonCommercialConfirmed: boolean;
  unofficialAndUnaffiliatedConfirmed: boolean;
  guardianJointlyConfirmed: boolean;
}

export interface FanStudyAgreement {
  termsVersion: string;
  acceptedAt: number | null;
  confirmations: FanStudyConfirmations;
}

export interface OriginalDeckContentPolicy {
  schemaVersion: 1;
  mode: 'original';
}

export interface FanStudyDeckContentPolicy {
  schemaVersion: 1;
  mode: 'fan-study';
  agreement: FanStudyAgreement;
}

export type DeckContentPolicy = OriginalDeckContentPolicy | FanStudyDeckContentPolicy;

export interface DeckData {
  id: string;
  theme: string;
  name: string;
  modeId: GameModeId;
  story: string;
  rules: string;
  cards: CardData[];
  author: string;
  artStyleId?: ArtStyleId;
  cardBack?: CardBackDesign;
  ruleKit?: RuleKit;
  creatorPlaque?: CreatorPlaque;
  composition?: DeckComposition;
  revision?: DeckRevision;
  /** Missing on legacy decks and intentionally resolves to the default original mode. */
  contentPolicy?: DeckContentPolicy;
  provenance?: {
    cid: string;
    signerPeerId: string;
    publicKey?: string;
    signature: string;
  };
}

export interface DeckLibraryData {
  schemaVersion: 1;
  activeDeckId: string | null;
  activeDeckCid: string | null;
  activeDeckRevision: DeckRevisionReference | null;
  decks: DeckData[];
}

export interface P2pIdentity {
  peerId: string;
  displayName: string;
  connectionCode: string;
  listenAddresses: string[];
}

export interface P2pPeer {
  peerId: string;
  displayName: string;
  address: string;
  connected: boolean;
  nearby: boolean;
  verified: boolean;
  lastSeen: number;
}

export type ExchangeOfferStatus = 'pending' | 'accepted' | 'declined' | 'completed' | 'failed';

export interface ExchangeOffer {
  id: string;
  direction: 'incoming' | 'outgoing';
  status: ExchangeOfferStatus;
  peerId: string;
  peerName: string;
  deck: DeckData;
  cid: string;
  signatureValid: boolean;
  createdAt: number;
}

export interface P2pSnapshot {
  running: boolean;
  identity: P2pIdentity | null;
  peers: P2pPeer[];
  offers: ExchangeOffer[];
  lastError?: string;
}

export interface P2pStartResult {
  snapshot: P2pSnapshot;
  leaseId: string | null;
}

export interface ApiArtworkRetry {
  /** One-based position inside the requested generation batch. */
  cardNumber: number;
  cardName: string;
  attempts: number;
}

export interface ApiArtworkFailure extends ApiArtworkRetry {
  code: string;
  message: string;
}

export interface ApiGenerationErrorDetails {
  artworkFailures?: ApiArtworkFailure[];
}

export interface ApiGeneratedDeckResponse {
  ok: true;
  requestId: string;
  deck: {
    name: string;
    tagline: string;
    world: string;
    rules: string[];
    cards: Array<{
      name: string;
      role: string;
      ability: string;
      flavorText: string;
      attack: number;
      defense: number;
      rarity: CardData['rarity'];
      artwork: {
        dataUrl: string;
        mimeType: string;
        revisedPrompt?: string;
      };
    }>;
    artwork: {
      dataUrl: string;
      mimeType: string;
      revisedPrompt?: string;
    };
    artworkRetries?: ApiArtworkRetry[];
    artworkFailures?: ApiArtworkFailure[];
  };
}

export interface ApiErrorResponse {
  ok: false;
  requestId?: string;
  error?: {
    code?: string;
    message?: string;
    details?: ApiGenerationErrorDetails;
  };
}

export type ViewportBreakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

export type ViewportProfileId =
  | 'phone-portrait'
  | 'phone-landscape'
  | 'tablet'
  | 'compact-desktop'
  | 'desktop'
  | 'wide';

export type ViewportOrientation = 'portrait' | 'landscape' | 'square';

/** Controls information density. It is intentionally independent from device pixel ratio. */
export type ViewportDensity = 'dense' | 'regular' | 'spacious';

export type ViewportRenderDensity = 'economy' | 'balanced' | 'high';

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewportRect extends ViewportSize {
  x: number;
  y: number;
  right: number;
  bottom: number;
}

export interface ViewportMinimums extends ViewportSize {
  widthDeficit: number;
  heightDeficit: number;
  fitScale: number;
  met: boolean;
}

export interface ViewportProfile {
  id: ViewportProfileId;
  breakpoint: ViewportBreakpoint;
  orientation: ViewportOrientation;
  density: ViewportDensity;
  phone: boolean;
  tablet: boolean;
  desktop: boolean;
  compact: boolean;
  lowHeight: boolean;
  ultraWide: boolean;
  gutter: number;
  gap: number;
  navigationHeight: number;
  minimumTouchSize: number;
  maxContentWidth: number;
}

export interface ViewportOptions {
  /** Platform insets, for example values read from CSS env(safe-area-inset-*). */
  safeArea?: Partial<ViewportInsets>;
  /** Smallest scene size before a scene should scale, paginate, or switch layout mode. */
  minimumSize?: Partial<ViewportSize>;
  /** Uncapped display DPR used to calculate a performance-aware recommendation. */
  devicePixelRatio?: number;
  /** Maximum physical pixels rendered per frame when recommending a DPR. */
  pixelBudget?: number;
}

export interface ViewportRegionOptions {
  /** Total top navigation height, including any decoration drawn behind it. */
  headerHeight?: number;
  footerHeight?: number;
  gap?: number;
  /** Additional padding inside the safe rectangle. */
  inset?: number | Partial<ViewportInsets>;
  maxContentWidth?: number;
  minimumContentSize?: Partial<ViewportSize>;
}

export interface ViewportRegions {
  canvas: ViewportRect;
  safe: ViewportRect;
  header: ViewportRect;
  body: ViewportRect;
  content: ViewportRect;
  footer: ViewportRect;
  layoutSize: ViewportSize;
  fitScale: number;
  meetsMinimum: boolean;
}

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
  recommendedDpr: number;
  renderDensity: ViewportRenderDensity;
  compact: boolean;
  phone: boolean;
  tablet: boolean;
  desktop: boolean;
  lowHeight: boolean;
  ultraWide: boolean;
  breakpoint: ViewportBreakpoint;
  orientation: ViewportOrientation;
  density: ViewportDensity;
  profile: ViewportProfile;
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeLeft: number;
  safeArea: ViewportInsets;
  safeRect: ViewportRect;
  usableWidth: number;
  usableHeight: number;
  minimums: ViewportMinimums;
}
