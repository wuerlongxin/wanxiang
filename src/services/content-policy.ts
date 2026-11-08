import type {
  DeckContentPolicy,
  DeckCreationMode,
  DeckData,
  FanStudyConfirmations,
  FanStudyDeckContentPolicy,
  OriginalDeckContentPolicy,
} from '../types';

export const DECK_CONTENT_POLICY_SCHEMA_VERSION = 1 as const;
export const FAN_STUDY_TERMS_VERSION = '1.0';
export const FAN_STUDY_EXPORT_MARK = '非商业同人创作 / 非官方授权';

export const FAN_STUDY_DISCLAIMER =
  '“个人同人研习”模式仅供用户在本机进行个人、非商业的学习、研究与同人创作。相关角色、名称、标识、设定及素材的知识产权归各自权利人所有；万象卡域及作品创作者与原权利人之间不存在授权、赞助、认可或其他关联。启用本模式不会授予、转让或暗示任何知识产权许可，免责声明与用户确认也不能替代权利人的明确授权；完成勾选不代表相关使用当然合法，本软件亦不对素材权利或具体使用方式作合法性保证。用户应确保对自行提供、导入及生成所依据的素材拥有合法使用权或已取得必要许可，不得将相关内容用于销售、收费交换、众筹、广告推广或其他商业用途；拟公开传播或商业使用前，应自行取得必要授权并遵守适用法律及平台规则。如使用者未成年，应由其监护人共同阅读并确认本条款。';

export type FanStudyConfirmationId = keyof FanStudyConfirmations;

export const FAN_STUDY_CONFIRMATION_LABELS: Readonly<
  Record<FanStudyConfirmationId, string>
> = {
  materialsRightsConfirmed: '我确认对所使用、导入及生成的素材拥有合法权利或已取得必要许可',
  personalNonCommercialConfirmed: '我确认本套牌仅用于个人、非商业的本机研习',
  unofficialAndUnaffiliatedConfirmed: '我理解本作品并非官方授权，且本声明不等于取得授权',
  guardianJointlyConfirmed: '我确认：如使用者未成年，监护人已共同阅读并确认本条款',
};

export type DeckExportPolicyFailureCode =
  | 'FAN_STUDY_CONFIRMATIONS_REQUIRED'
  | 'FAN_STUDY_TERMS_OUTDATED'
  | 'FAN_STUDY_ACCEPTANCE_INVALID';

export interface DeckExportPolicyAllowed {
  allowed: true;
  mode: DeckCreationMode;
  exportMark: string | null;
  disclaimer: string | null;
}

export interface DeckExportPolicyDenied {
  allowed: false;
  mode: 'fan-study';
  code: DeckExportPolicyFailureCode;
  message: string;
  missingConfirmations: FanStudyConfirmationId[];
}

export type DeckExportPolicyResult = DeckExportPolicyAllowed | DeckExportPolicyDenied;

export class DeckExportPolicyError extends Error {
  readonly code: DeckExportPolicyFailureCode;
  readonly missingConfirmations: FanStudyConfirmationId[];

  constructor(result: DeckExportPolicyDenied) {
    super(result.message);
    this.name = 'DeckExportPolicyError';
    this.code = result.code;
    this.missingConfirmations = result.missingConfirmations;
  }
}

const EMPTY_FAN_STUDY_CONFIRMATIONS: FanStudyConfirmations = {
  materialsRightsConfirmed: false,
  personalNonCommercialConfirmed: false,
  unofficialAndUnaffiliatedConfirmed: false,
  guardianJointlyConfirmed: false,
};

const MAX_SAFE_TIMESTAMP = Number.MAX_SAFE_INTEGER;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isSafeTimestamp(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= MAX_SAFE_TIMESTAMP
  );
}

function isTermsVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 32 &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    })
  );
}

export function allFanStudyConfirmationsAccepted(
  confirmations: FanStudyConfirmations,
): boolean {
  return Object.keys(FAN_STUDY_CONFIRMATION_LABELS).every(
    (key) => confirmations[key as FanStudyConfirmationId],
  );
}

export function isFanStudyConfirmations(value: unknown): value is FanStudyConfirmations {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      'materialsRightsConfirmed',
      'personalNonCommercialConfirmed',
      'unofficialAndUnaffiliatedConfirmed',
      'guardianJointlyConfirmed',
    ])
  ) {
    return false;
  }
  return (
    typeof value.materialsRightsConfirmed === 'boolean' &&
    typeof value.personalNonCommercialConfirmed === 'boolean' &&
    typeof value.unofficialAndUnaffiliatedConfirmed === 'boolean' &&
    typeof value.guardianJointlyConfirmed === 'boolean'
  );
}

export function isDeckContentPolicy(value: unknown): value is DeckContentPolicy {
  if (!isRecord(value) || value.schemaVersion !== DECK_CONTENT_POLICY_SCHEMA_VERSION) {
    return false;
  }
  if (value.mode === 'original') {
    return hasExactlyKeys(value, ['schemaVersion', 'mode']);
  }
  if (
    value.mode !== 'fan-study' ||
    !hasExactlyKeys(value, ['schemaVersion', 'mode', 'agreement']) ||
    !isRecord(value.agreement) ||
    !hasExactlyKeys(value.agreement, ['termsVersion', 'acceptedAt', 'confirmations']) ||
    !isTermsVersion(value.agreement.termsVersion) ||
    !isFanStudyConfirmations(value.agreement.confirmations)
  ) {
    return false;
  }

  const fullyAccepted = allFanStudyConfirmationsAccepted(value.agreement.confirmations);
  return fullyAccepted
    ? isSafeTimestamp(value.agreement.acceptedAt)
    : value.agreement.acceptedAt === null;
}

export function createOriginalDeckContentPolicy(): OriginalDeckContentPolicy {
  return { schemaVersion: DECK_CONTENT_POLICY_SCHEMA_VERSION, mode: 'original' };
}

export function createFanStudyDeckContentPolicy(
  confirmations: Partial<FanStudyConfirmations> = {},
  acceptedAt: number = Date.now(),
  termsVersion: string = FAN_STUDY_TERMS_VERSION,
): FanStudyDeckContentPolicy {
  const normalizedConfirmations: FanStudyConfirmations = {
    ...EMPTY_FAN_STUDY_CONFIRMATIONS,
    ...confirmations,
  };
  const policy: FanStudyDeckContentPolicy = {
    schemaVersion: DECK_CONTENT_POLICY_SCHEMA_VERSION,
    mode: 'fan-study',
    agreement: {
      termsVersion,
      acceptedAt: allFanStudyConfirmationsAccepted(normalizedConfirmations) ? acceptedAt : null,
      confirmations: normalizedConfirmations,
    },
  };
  if (!isDeckContentPolicy(policy)) {
    throw new TypeError('个人同人研习确认信息无效。');
  }
  return policy;
}

export function requireExplicitDeckContentPolicy(
  deck: Pick<DeckData, 'contentPolicy'>,
  onMissing: () => void,
): boolean {
  if (isDeckContentPolicyAccepted(deck)) return true;
  onMissing();
  return false;
}

export function isDeckContentPolicyAccepted(
  deck: Pick<DeckData, 'contentPolicy'>,
): boolean {
  return Boolean(deck.contentPolicy) && validateDeckExportPolicy(deck).allowed;
}

export function resolveDeckContentPolicy(deck: Pick<DeckData, 'contentPolicy'>): DeckContentPolicy {
  return deck.contentPolicy ?? createOriginalDeckContentPolicy();
}

export function resolveDeckCreationMode(deck: Pick<DeckData, 'contentPolicy'>): DeckCreationMode {
  return resolveDeckContentPolicy(deck).mode;
}

/** Fan-study decks stay local; original decks can be exchanged directly. */
export function canExchangeDeck(deck: Pick<DeckData, 'contentPolicy'>): boolean {
  return resolveDeckCreationMode(deck) === 'original';
}

export function getExportMark(deck: Pick<DeckData, 'contentPolicy'>): string | null {
  return resolveDeckCreationMode(deck) === 'fan-study' ? FAN_STUDY_EXPORT_MARK : null;
}

export function validateDeckExportPolicy(
  deck: Pick<DeckData, 'contentPolicy'>,
): DeckExportPolicyResult {
  const policy = resolveDeckContentPolicy(deck);
  if (policy.mode === 'original') {
    return { allowed: true, mode: 'original', exportMark: null, disclaimer: null };
  }

  const missingConfirmations = (
    Object.keys(FAN_STUDY_CONFIRMATION_LABELS) as FanStudyConfirmationId[]
  ).filter((key) => !policy.agreement.confirmations[key]);
  if (missingConfirmations.length > 0) {
    return {
      allowed: false,
      mode: 'fan-study',
      code: 'FAN_STUDY_CONFIRMATIONS_REQUIRED',
      message: '导出前需完成“个人同人研习”模式的全部权利与非商业使用确认。',
      missingConfirmations,
    };
  }
  if (policy.agreement.termsVersion !== FAN_STUDY_TERMS_VERSION) {
    return {
      allowed: false,
      mode: 'fan-study',
      code: 'FAN_STUDY_TERMS_OUTDATED',
      message: '“个人同人研习”条款已更新，请阅读并重新确认后再导出。',
      missingConfirmations: [],
    };
  }
  if (!isSafeTimestamp(policy.agreement.acceptedAt)) {
    return {
      allowed: false,
      mode: 'fan-study',
      code: 'FAN_STUDY_ACCEPTANCE_INVALID',
      message: '“个人同人研习”确认时间无效，请重新确认后再导出。',
      missingConfirmations: [],
    };
  }
  return {
    allowed: true,
    mode: 'fan-study',
    exportMark: FAN_STUDY_EXPORT_MARK,
    disclaimer: FAN_STUDY_DISCLAIMER,
  };
}

export function assertDeckExportAllowed(
  deck: Pick<DeckData, 'contentPolicy'>,
): DeckExportPolicyAllowed {
  const result = validateDeckExportPolicy(deck);
  if (!result.allowed) throw new DeckExportPolicyError(result);
  return result;
}

export function canExportDeck(deck: Pick<DeckData, 'contentPolicy'>): boolean {
  return validateDeckExportPolicy(deck).allowed;
}
