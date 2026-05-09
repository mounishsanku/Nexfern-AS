import { useLocalization } from "@/context/LocalizationContext";
import { Badge } from "@/components/ui/Badge";

export function SecuritySettings() {
  const { features } = useLocalization();

  const useSecurityHardening = features?.USE_SECURITY_HARDENING === true;
  const useEncryptedBackups = features?.USE_ENCRYPTED_BACKUPS === true;

  if (!useSecurityHardening) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-gray-500 min-h-[400px]">
        <div className="w-16 h-16 mb-4 text-gray-300">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-xl font-medium mb-2 text-gray-800 dark:text-gray-200">Security Infrastructure Disabled</h2>
        <p className="max-w-md text-gray-500 dark:text-gray-400">
          Enterprise Security Hardening is currently disabled. Enable `USE_SECURITY_HARDENING` in settings to view access logs, incidents, and MFA status.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Enterprise Security</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Manage system access, encrypted backups, and security incidents.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Multi-Factor Authentication</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Protect your administrator account with two-step verification using an authenticator app.
          </p>
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-500 rounded-lg">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Authenticator App</p>
                <p className="text-sm text-gray-500">Not configured</p>
              </div>
            </div>
            <button disabled className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg opacity-50 cursor-not-allowed">
              Enable MFA
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Encrypted Backups</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            System backups are encrypted via AES-256-CBC. Keep your encryption key safe.
          </p>
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-500 rounded-lg">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Encryption Policy</p>
                <p className="text-sm text-gray-500">
                  {useEncryptedBackups ? "Enforced (AES-256)" : "Disabled (Plaintext allowed)"}
                </p>
              </div>
            </div>
            {useEncryptedBackups ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="warning">Off</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Access Logs</h2>
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-4">
            Detailed access logs and incident tracking interface will be available in the next security rollout. Access logs are currently being captured securely via middleware.
          </p>
        </div>
      </div>
    </div>
  );
}
