const queries = require('../db/queries');

async function list(req, res) {
  const result = await queries.listCompetitors(req.userId);
  res.render('competitors/list', { competitors: result.rows, error: null });
}

async function create(req, res) {
  const { name, website_url } = req.body;
  if (!name || !website_url) {
    const result = await queries.listCompetitors(req.userId);
    return res.render('competitors/list', {
      competitors: result.rows,
      error: 'Name and website URL are required.',
    });
  }
  await queries.createCompetitor(req.userId, name, website_url);
  res.redirect('/competitors');
}

async function showEditForm(req, res) {
  const result = await queries.getCompetitorOwned(req.params.id, req.userId);
  if (result.rows.length === 0) return res.redirect('/competitors');
  res.render('competitors/edit', { competitor: result.rows[0], error: null });
}

async function update(req, res) {
  const { name, website_url } = req.body;
  if (!name || !website_url) {
    const owned = await queries.getCompetitorOwned(req.params.id, req.userId);
    if (owned.rows.length === 0) return res.redirect('/competitors');
    return res.render('competitors/edit', {
      competitor: owned.rows[0],
      error: 'Name and website URL are required.',
    });
  }
  await queries.updateCompetitor(req.params.id, req.userId, name, website_url);
  res.redirect('/competitors');
}

async function remove(req, res) {
  await queries.deleteCompetitor(req.params.id, req.userId);
  res.redirect('/competitors');
}

module.exports = { list, create, showEditForm, update, remove };