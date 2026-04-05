import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'lib', 'data');
const PROFILES_DIR = path.join(process.cwd(), 'lib', 'agents', 'profiles');

const FILE_MAP = {
  faq: path.join(DATA_DIR, 'faq.json'),
  pricing: path.join(DATA_DIR, 'pricing.json'),
  regulations: path.join(DATA_DIR, 'regulations.json'),
  'scrape-sources': path.join(DATA_DIR, 'scrape-sources.json'),
  'router-config': path.join(DATA_DIR, 'router-config.json'),
};

function auth(req) {
  const adminKey = process.env.ADMIN_SECRET || 'admin';
  const key = req.headers['x-admin-key'] || req.query.key;
  return process.env.NODE_ENV !== 'production' || key === adminKey;
}

/**
 * Config CRUD API
 *
 * GET  /api/admin/config?file=faq                    → read data file
 * PUT  /api/admin/config?file=faq                    → write data file
 * GET  /api/admin/config?file=profiles               → read all agent profiles
 * PUT  /api/admin/config?file=profile&name=customs   → write one profile
 * GET  /api/admin/config?file=all                    → read everything
 */
export default async function handler(req, res) {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { file, name } = req.query;

  try {
    if (req.method === 'GET') {
      // Read all config at once
      if (file === 'all') {
        const result = {};
        for (const [key, filePath] of Object.entries(FILE_MAP)) {
          try { result[key] = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { result[key] = null; }
        }
        // Add profiles
        result.profiles = readAllProfiles();
        return res.status(200).json(result);
      }

      // Read all profiles
      if (file === 'profiles') {
        return res.status(200).json(readAllProfiles());
      }

      // Read single profile
      if (file === 'profile' && name) {
        const profilePath = path.join(PROFILES_DIR, `${name}.json`);
        if (!fs.existsSync(profilePath)) return res.status(404).json({ error: `Profile ${name} not found` });
        return res.status(200).json(JSON.parse(fs.readFileSync(profilePath, 'utf-8')));
      }

      // Read data file
      const filePath = FILE_MAP[file];
      if (!filePath) return res.status(400).json({ error: `Unknown file: ${file}. Valid: ${Object.keys(FILE_MAP).join(', ')}, profiles, all` });
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: `File not found: ${file}` });
      return res.status(200).json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    }

    if (req.method === 'PUT') {
      const data = req.body;
      if (!data) return res.status(400).json({ error: 'Request body required' });

      // Write profile
      if (file === 'profile' && name) {
        const safeName = name.replace(/[^a-z0-9_-]/g, '');
        const profilePath = path.join(PROFILES_DIR, `${safeName}.json`);
        fs.writeFileSync(profilePath, JSON.stringify(data, null, 2), 'utf-8');
        return res.status(200).json({ success: true, file: `profiles/${safeName}.json` });
      }

      // Write data file
      const filePath = FILE_MAP[file];
      if (!filePath) return res.status(400).json({ error: `Unknown file: ${file}` });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return res.status(200).json({ success: true, file });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

function readAllProfiles() {
  const profiles = {};
  try {
    const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    for (const f of files) {
      const name = f.replace('.json', '');
      profiles[name] = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf-8'));
    }
  } catch {}
  return profiles;
}
