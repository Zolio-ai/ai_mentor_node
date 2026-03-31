const dataService = require('../services/dataService');

exports.saveData = async (req, res) => {
    try {
        const userId = req.user.id; // from auth middleware
        const data = await dataService.createData(userId, req.body);
        res.status(201).json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getData = async (req, res) => {
    try {
        const userId = req.user.id; // from auth middleware
        const data = await dataService.getUserData(userId);
        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
