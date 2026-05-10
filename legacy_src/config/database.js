const { Sequelize } = require("sequelize");
const { config } = require("./env");

const sequelize =
  config.dbDialect === "sqlite"
    ? new Sequelize({
        dialect: "sqlite",
        storage: config.db.storage,
        logging: false,
        pool: {
          max: 1,
          min: 1,
          acquire: 30000,
          idle: 10000
        },
        retry: {
          max: 5
        }
      })
    : new Sequelize(config.db.name, config.db.user, config.db.password, {
        host: config.db.host,
        port: config.db.port,
        dialect: "mysql",
        logging: false,
        define: {
          underscored: true,
          freezeTableName: true
        },
        pool: {
          max: 10,
          min: 0,
          acquire: 30000,
          idle: 10000
        },
        retry: {
          max: 3
        }
      });

module.exports = { sequelize };
