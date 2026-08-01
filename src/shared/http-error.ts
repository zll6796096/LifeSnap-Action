export type PublicErrorKey =
  | "APP_CHECK_REQUIRED"
  | "APP_CHECK_INVALID"
  | "APP_CHECK_REPLAYED"
  | "APP_ID_FORBIDDEN"
  | "SECURITY_SERVICE_UNAVAILABLE"
  | "INSTALLATION_ID_INVALID"
  | "MULTIPART_REQUEST_INVALID"
  | "IMAGE_REQUIRED"
  | "LEGACY_UNSUPPORTED_IMAGE_TYPE"
  | "V2_UNSUPPORTED_IMAGE_TYPE"
  | "LEGACY_IMAGE_TOO_LARGE"
  | "V2_IMAGE_TOO_LARGE"
  | "INSTALL_RATE_LIMITED"
  | "INSTALL_DAILY_LIMITED"
  | "SERVICE_DAILY_LIMITED"
  | "AI_SERVICE_UNAVAILABLE"
  | "AI_EMPTY_RESPONSE"
  | "AI_EXTRACTION_FAILED"
  | "INTERNAL_ERROR";

export type PublicHttpErrorSnapshot = Readonly<{
  statusCode: number;
  code: string;
  publicMessage: string;
}>;

function entry(
  statusCode: number,
  code: string,
  publicMessage: string,
): PublicHttpErrorSnapshot {
  return Object.freeze({ statusCode, code, publicMessage });
}

const PUBLIC_ERROR_CATALOG: Readonly<
  Record<PublicErrorKey, PublicHttpErrorSnapshot>
> = Object.freeze({
  APP_CHECK_REQUIRED: entry(
    401,
    "APP_CHECK_REQUIRED",
    "App Check トークンが必要です。",
  ),
  APP_CHECK_INVALID: entry(
    401,
    "APP_CHECK_INVALID",
    "App Check トークンが無効です。",
  ),
  APP_CHECK_REPLAYED: entry(
    401,
    "APP_CHECK_REPLAYED",
    "App Check トークンはすでに使用されています。",
  ),
  APP_ID_FORBIDDEN: entry(
    403,
    "APP_ID_FORBIDDEN",
    "このアプリからのリクエストは許可されていません。",
  ),
  SECURITY_SERVICE_UNAVAILABLE: entry(
    503,
    "SECURITY_SERVICE_UNAVAILABLE",
    "セキュリティ確認サービスを一時的に利用できません。しばらくしてからもう一度お試しください。",
  ),
  INSTALLATION_ID_INVALID: entry(
    400,
    "INSTALLATION_ID_INVALID",
    "インストール識別子が無効です。",
  ),
  MULTIPART_REQUEST_INVALID: entry(
    400,
    "MULTIPART_REQUEST_INVALID",
    "画像アップロードの形式が無効です。",
  ),
  IMAGE_REQUIRED: entry(
    400,
    "IMAGE_REQUIRED",
    "画像データが必要です。multipart/form-data の image フィールドで送信してください。",
  ),
  LEGACY_UNSUPPORTED_IMAGE_TYPE: entry(
    400,
    "UNSUPPORTED_IMAGE_TYPE",
    "許可されていない画像形式です。JPEG、PNG、WebP画像のみアップロード可能です。",
  ),
  V2_UNSUPPORTED_IMAGE_TYPE: entry(
    415,
    "UNSUPPORTED_IMAGE_TYPE",
    "許可されていない画像形式です。JPEG、PNG、WebP画像のみアップロード可能です。",
  ),
  LEGACY_IMAGE_TOO_LARGE: entry(
    400,
    "IMAGE_TOO_LARGE",
    "画像サイズが大きすぎます。10MB以下の画像をアップロードしてください。",
  ),
  V2_IMAGE_TOO_LARGE: entry(
    413,
    "IMAGE_TOO_LARGE",
    "画像サイズが大きすぎます。10MB以下の画像をアップロードしてください。",
  ),
  INSTALL_RATE_LIMITED: entry(
    429,
    "INSTALL_RATE_LIMITED",
    "短時間の利用上限に達しました。しばらくしてからもう一度お試しください。",
  ),
  INSTALL_DAILY_LIMITED: entry(
    429,
    "INSTALL_DAILY_LIMITED",
    "本日の利用上限に達しました。時間をおいてもう一度お試しください。",
  ),
  SERVICE_DAILY_LIMITED: entry(
    429,
    "SERVICE_DAILY_LIMITED",
    "本日のサービス利用上限に達しました。時間をおいてもう一度お試しください。",
  ),
  AI_SERVICE_UNAVAILABLE: entry(
    503,
    "AI_SERVICE_UNAVAILABLE",
    "AI解析サービスを一時的に利用できません。しばらくしてからもう一度お試しください。",
  ),
  AI_EMPTY_RESPONSE: entry(
    502,
    "AI_EMPTY_RESPONSE",
    "AI解析サービスから有効な応答を取得できませんでした。",
  ),
  AI_EXTRACTION_FAILED: entry(
    502,
    "AI_EXTRACTION_FAILED",
    "画像の解析中にエラーが発生しました。しばらくしてからもう一度お試しください。",
  ),
  INTERNAL_ERROR: entry(
    500,
    "INTERNAL_ERROR",
    "サーバーエラーが発生しました。",
  ),
});

const ERROR_KEYS = new WeakMap<object, PublicErrorKey>();

class CatalogHttpError extends Error {
  constructor(publicMessage: string) {
    super(publicMessage);
    this.name = "PublicHttpError";
  }
}

export function createPublicHttpError(key: PublicErrorKey): Error {
  const error = new CatalogHttpError(
    PUBLIC_ERROR_CATALOG[key].publicMessage,
  );
  ERROR_KEYS.set(error, key);
  return Object.freeze(error);
}

export function normalizePublicHttpError(
  error: unknown,
): PublicHttpErrorSnapshot | undefined {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  let key: PublicErrorKey | undefined;
  try {
    key = ERROR_KEYS.get(error as object);
  } catch {
    return undefined;
  }
  return key === undefined ? undefined : PUBLIC_ERROR_CATALOG[key];
}
