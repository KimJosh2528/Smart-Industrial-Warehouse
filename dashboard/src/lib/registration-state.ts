export type RegistrationState = {
  success: boolean;
  message: string;
  requiresConfirmation?: boolean;
  email?: string;
  diagnostic?: {
    name: string;
    code: string;
    status: number | null;
    message: string;
  };
};

export const registrationInitial: RegistrationState = { success: false, message: "" };
