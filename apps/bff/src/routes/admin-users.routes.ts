import { Router } from "express";
import { IdentityProvisioningService } from "../services/identity-provisioning.service";

const router = Router();
const identityProvisioningService = new IdentityProvisioningService();

router.post("/provision", async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      username,
      password,
      groupName,
      roleName,
      projectCode,
      roleKey,
      disciplineKey,
      openProjectProjectId
    } = req.body as {
      email?: string;
      firstName?: string;
      lastName?: string;
      username?: string;
      password?: string;
      groupName?: string;
      roleName?: string;
      projectCode?: string;
      roleKey?: string;
      disciplineKey?: string;
      openProjectProjectId?: number;
    };

    const resolvedRole = roleKey || roleName;

    if (!email || !firstName || !lastName || !username || !resolvedRole) {
      return res.status(400).json({
        success: false,
        message:
          "email, firstName, lastName, username y roleKey/roleName son obligatorios"
      });
    }

    const result = await identityProvisioningService.provisionUser({
      email,
      firstName,
      lastName,
      username,
      password,
      groupName,
      roleName,
      projectCode,
      roleKey,
      disciplineKey,
      openProjectProjectId
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("[admin-users.routes] POST /provision error:", error);

    const message =
      error instanceof Error ? error.message : "No se pudo provisionar usuario";

    return res.status(500).json({
      success: false,
      message
    });
  }
});

export default router;