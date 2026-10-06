import { Router } from 'express';
import { getGraphicalRepresentation } from '../db/bim-graphical-representation';
import { isBimRevisionId } from '../services/bim-revision-identity';
import { toCanonicalBimModelKey } from '../services/bim-model-identity';
import { normalizeProjectCode } from '../security/project-access';

const router = Router();
router.post('/', async (req, res) => {
  const { projectCode, modelKey, revisionId, localIds } = req.body ?? {};
  if (typeof projectCode !== 'string' || !projectCode.trim() || typeof modelKey !== 'string' ||
    !isBimRevisionId(revisionId) || !Array.isArray(localIds) || localIds.length > 2048 ||
    localIds.some(id => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647))
    return res.status(400).json({ success: false, message: 'Invalid graphical representation request' });
  let canonical;
  try { canonical = toCanonicalBimModelKey(modelKey); }
  catch { return res.status(400).json({ success: false, message: 'Noncanonical model key' }); }
  if (canonical !== modelKey) return res.status(400).json({ success: false, message: 'Noncanonical model key' });
  try {
    const data = await getGraphicalRepresentation({ projectCode: normalizeProjectCode(projectCode), modelKey: canonical, revisionId }, localIds);
    if (!data) return res.status(409).json({ success: false, message: 'Revision is not published or has no authoring evidence' });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[bim-graphical-representation]', error);
    return res.status(500).json({ success: false, message: 'Graphical representation unavailable' });
  }
});
export default router;
