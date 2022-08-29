#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const yargs_1 = __importDefault(require("yargs/yargs"));
const yaml_1 = require("yaml");
const fs = __importStar(require("fs"));
const validator_1 = __importDefault(require("validator"));
const axios_1 = __importDefault(require("axios"));
const argv = yargs_1.default(process.argv.slice(2)).options({
    // Data to change info
    domain: { type: 'string', required: true },
    token: { type: 'string', required: true },
    config: { type: 'string', required: true }
}).argv;
// Verify domain name
const domain = argv.domain;
if (!validator_1.default.isFQDN(domain)) {
    console.error(`Domain ${domain} is not a FQDN!`);
    process.exit(-1);
}
// Load config
const file = fs.readFileSync(argv.config, 'utf8');
const config = yaml_1.parse(file);
const domainConfig = config.domains[domain];
// Validate config
if (typeof domainConfig === "undefined") {
    console.error(`Can't find domain config for ${domain}`);
    process.exit(-1);
}
if (!validator_1.default.isURL(domainConfig.endpoint)) {
    console.error(`Endpoint ${domainConfig.endpoint} is not a valid domain!`);
    process.exit(-1);
}
if (!domainConfig.endpoint.endsWith('/api/v2/')) {
    console.error(`Endpoint ${domainConfig.endpoint} is not a valid endpoint! Make sure it ends on /api/v2/`);
    process.exit(-1);
}
// Setup API connection
const ax = axios_1.default.create({
    baseURL: domainConfig.endpoint,
    headers: {
        'X-API-Key': domainConfig.apikey,
        'ACCEPT': 'application/json'
    }
});
/**
 * Recursively search for the highest level domain
 * @param domainResponse domain to start the search off
 * @return Promise Promise for highest leveled domain
 */
function getTopLeveledDomain(domainResponse) {
    return __awaiter(this, void 0, void 0, function* () {
        let data = yield ax.get(`domains/${domainResponse.id_parent_domain}`);
        if (data.status === 200) {
            data = data.data;
        }
        else {
            return false;
        }
        if (data.id_parent_domain === 0) {
            return data;
        }
        else {
            return getTopLeveledDomain(data);
        }
    });
}
/**
 * Builds and puts the acme dns to the dns server
 * @param id domain id
 * @param acmeDns acme dns
 */
function buildAndPutAcmeChallange(id, acmeDns = '_acme-challange') {
    ax.get(`dns/${id}`).then((r) => {
        let records = r.data.records;
        if (records.other.find((e) => e.host === acmeDns)) {
            records.other.find((e) => e.host === acmeDns).value = argv.token;
            records.other.find((e) => e.host === acmeDns).ttl = 300;
        }
        else {
            records.other.push({
                host: acmeDns,
                ttl: 300,
                type: 'TXT',
                value: argv.token
            });
        }
        ax.put(`dns/${id}`, { records }).then((r) => {
            console.log(`Successfully put acme challange(${acmeDns}) to DNS with id: ${r.data.id}`);
            process.exit(0);
        }).catch(e => {
            console.error(e);
            process.exit(-1);
        });
    });
}
ax.get(`domains/name/${domainConfig.alias}`).then((r) => {
    const domainResponse = r.data;
    if (domainResponse.id_parent_domain === 0) {
        buildAndPutAcmeChallange(domainResponse.id);
    }
    else {
        getTopLeveledDomain(domainResponse).then((topLeveledDomain) => {
            const subdomain = domainConfig.alias.replace(topLeveledDomain.domain, '').replace(/\.+$/, '');
            buildAndPutAcmeChallange(topLeveledDomain.id, `_acme-challange.${subdomain}`);
        });
    }
}).catch((e) => {
    if (e.response.status === 404) {
        console.error(`Could not find ${domainConfig.alias} on this endpoint!`);
        process.exit(-1);
    }
    console.error(e);
    process.exit(-1);
});
