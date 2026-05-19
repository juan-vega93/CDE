import { Router } from "express";
import { ProjectMembersService } from "../services/project-members.service";
import type {
  CreateProjectMemberInput,
  UpdateProjectMemberInput
} from "../types/project-member.types";

const router = Router({ mergeParams: true });
const projectMembersService = new ProjectMembersService();

router.get("/", async (req, res) => {
  try {
    const { code: projectCode } = req.params as { code: string };

    const status = String(req.query.status || "active").toLowerCase();

    const members = await projectMembersService.getByProjectCode(projectCode);

    const filteredMembers =
      status === "all"
        ? members
        : members.filter((member) => member.status === status);

    return res.json({
      success: true,
      data: filteredMembers
    });
  } catch (error) {
    console.error("[project-members.routes] GET / error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudieron listar los miembros del proyecto"
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const { code: projectCode } = req.params as { code: string };
    const input = req.body as CreateProjectMemberInput;

    if (
      !input.email ||
      !input.username ||
      !input.firstName ||
      !input.lastName ||
      !input.roleKey
    ) {
      return res.status(400).json({
        success: false,
        message:
          "email, username, firstName, lastName y roleKey son obligatorios"
      });
    }

    const member = await projectMembersService.addOrUpdateProjectMember(
      projectCode,
      input
    );

    return res.status(201).json({
      success: true,
      data: member
    });
  } catch (error) {
    console.error("[project-members.routes] POST / error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo agregar el miembro al proyecto"
    });
  }
});

router.put("/:memberId", async (req, res) => {
  try {
    const { code: projectCode } = req.params as {
      code: string;
      memberId: string;
    };

    const { memberId } = req.params as {
      code: string;
      memberId: string;
    };

    const input = req.body as UpdateProjectMemberInput;

    const member = await projectMembersService.updateProjectMember(
      projectCode,
      memberId,
      input
    );

    return res.json({
      success: true,
      data: member
    });
  } catch (error) {
    console.error("[project-members.routes] PUT /:memberId error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el miembro del proyecto"
    });
  }
});
router.delete("/:memberId", async (req, res) => {
  try {
    const { code: projectCode, memberId } = req.params as {
      code: string;
      memberId: string;
    };

    const member = await projectMembersService.removeProjectMember(
      projectCode,
      memberId
    );

    return res.json({
      success: true,
      data: member
    });
  } catch (error) {
    console.error("[project-members.routes] DELETE /:memberId error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo retirar el miembro del proyecto"
    });
  }
});

export default router;