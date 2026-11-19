export const appConfig = __APP_CONFIG__;
export function apiEndpoint(path: string) {
  return appConfig.apiUrl + '/' + path.replace(/^\//, '');
}
