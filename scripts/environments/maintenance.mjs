export function requireLocalDatabase(value) {
  if (!value || !['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname)) {
    throw new Error('Maintenance scripts only accept a local database; production and remote overrides are refused');
  }
}

export function requireLocalPostgres(env = process.env) {
  if (env.PGSERVICE || env.PGSERVICEFILE || env.PGHOSTADDR || !env.PGHOST ||
      !(env.PGHOST.startsWith('/') || ['localhost','127.0.0.1','::1'].includes(env.PGHOST)) ||
      /[=:\/]/.test(env.PGDATABASE ?? '')) {
    throw new Error('Use an explicit local PostgreSQL socket/host without service/connection-string overrides');
  }
}

export function requireLocalStorage(env = process.env) {
  requireLocalDatabase(env.R2_ENDPOINT);
  if (env.R2_ACCOUNT_ID !== 'local' || env.R2_ACCESS_KEY_ID !== 'local-development' || env.R2_BUCKET_NAME !== 'uxcommunity-development-media' || env.R2_PRIVATE_BUCKET_NAME !== 'uxcommunity-development-private') throw new Error('Use dedicated local media storage');
}
