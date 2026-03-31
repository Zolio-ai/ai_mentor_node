const Data = require('../models/data');

exports.createData = async (userId, dataPayload) => {
    const { title, content } = dataPayload;
    if (!title || !content) throw new Error('Please provide title and content');
    
    const newData = await Data.create({ userId, title, content });
    return newData;
};

exports.getUserData = async (userId) => {
    const data = await Data.find({ userId }).sort({ createdAt: -1 });
    return data;
};
