import { Router } from "express";
import { KeycloakAdminService } from "../services/keycloak-admin.service";
import {OpenProjectMembersService} from "../services/openproject-members.service";
import { NextcloudProvisioningService } from "../services/nextcloud-provisioning.service";

const router = Router();
const keycloakAdminService = new KeycloakAdminService();
const openProjectMembersService = new OpenProjectMembersService();
const nextcloudProvisioningService = new NextcloudProvisioningService();

router.post("/provision", async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      username,
      password,
      groupName,
      roleName
    } = req.body;

    if (!email || !firstName || !lastName || !username || !groupName || !roleName) {
      return res.status(400).json({
        success: false,
        message:
          "email, firstName, lastName, username, groupName y roleName son obligatorios"
      });
    }

    const user = await keycloakAdminService.ensureUser({
      email,
      firstName,
      lastName,
      username,
      password
    });

    const group = await keycloakAdminService.ensureGroup(groupName);

    await keycloakAdminService.addUserToGroup(user.id, group.id);
    await keycloakAdminService.assignRealmRoleToUser(user.id, roleName);

    const openProjectSync = await openProjectMembersService.ensureProjectMember({
      email,
      firstName: firstName || "",
      lastName: lastName || "",
      login: email,
      password: password || "Nc_Test_2026_X1!",
      roleName
    });

    const nextcloudSync = await nextcloudProvisioningService.ensureUserInGroup({
      username,
      password: password || "Temporal123!",
      email,
      displayName: `${firstName} ${lastName}`.trim(),
      groupName
    });

    return res.status(200).json({
      success: true,
      data: {
        userId: user.id,
        email: user.email,
        username: user.username,
        groupName,
        roleName,
        openProjectSync,
        nextcloudSync
      }
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