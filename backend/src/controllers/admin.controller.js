const adminService = require('../services/admin.service');

const getOverview = async (req, res, next) => {
  try {
    const overview = await adminService.getOverview();

    res.status(200).json({
      overview,
    });
  } catch (error) {
    next(error);
  }
};

const listCompanies = async (req, res, next) => {
  try {
    const companies = await adminService.listCompanies();

    res.status(200).json({
      companies,
    });
  } catch (error) {
    next(error);
  }
};

const listBilling = async (req, res, next) => {
  try {
    const payments = await adminService.listBilling();

    res.status(200).json({
      payments,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOverview,
  listCompanies,
  listBilling,
};
