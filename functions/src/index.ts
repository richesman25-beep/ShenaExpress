import { getApps, initializeApp } from "firebase-admin/app";

if (getApps().length === 0) {
  initializeApp();
}

export { clientSignIn, requestPasswordReset, verifyPasswordSetupToken, completePasswordSetup } from "./auth.js";
export {
  createClient,
  updateClient,
  setClientStatus,
  sendClientInvite,
  generateClientAccessLink,
  resetClientPassword,
  saveClientNotes,
} from "./clients.js";
export { createOrder, updateOrder, recordReceipt } from "./orders.js";
export { createShipment, updateShipment } from "./shipments.js";
export { updateStatus } from "./tracking.js";
export { setOrderCharges, recordPayment, voidPayment } from "./finance.js";
export { updateSettings, setStaffRole } from "./settings.js";
