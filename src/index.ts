#!/usr/bin/env node
import yargs from 'yargs/yargs';
import {parse} from 'yaml'
import * as fs from "fs";
import validator from "validator";
import axios, {AxiosResponse} from "axios";

const argv: { domain: string, token: string, config: string } | any = yargs(process.argv.slice(2)).options({
    // Data to change info
    domain: {type: 'string', required: true},
    token: {type: 'string', required: true},
    config: {type: 'string', required: true},
    delay: {type: 'number', required: false, default: 0}
}).argv;

// Verify domain name
const domain = argv.domain
if (!validator.isFQDN(domain)) {
    console.error(`Domain ${domain} is not a FQDN!`);
    process.exit(-1);
}

// Load config
const file = fs.readFileSync(argv.config, 'utf8')
const config: { domains: { alias: string, endpoint: string, apikey: string }[] } = parse(file)
const domainConfig = config.domains[domain];
// Validate config
if (typeof domainConfig === "undefined") {
    console.error(`Can't find domain config for ${domain}`);
    process.exit(-1);
}
if (!validator.isURL(domainConfig.endpoint)) {
    console.error(`Endpoint ${domainConfig.endpoint} is not a valid domain!`);
    process.exit(-1);
}
if (!domainConfig.endpoint.endsWith('/api/v2/')) {
    console.error(`Endpoint ${domainConfig.endpoint} is not a valid endpoint! Make sure it ends on /api/v2/`);
    process.exit(-1);
}
// Setup API connection
const ax = axios.create({
    baseURL: domainConfig.endpoint,
    headers: {
        'X-API-Key': domainConfig.apikey,
        'ACCEPT': 'application/json'
    }
})

/**
 * Recursively search for the highest level domain
 * @param domainResponse domain to start the search off
 * @return Promise Promise for highest leveled domain
 */
async function getTopLeveledDomain(domainResponse: { id: number, id_parent_domain: number }): Promise<{ id: number, id_parent_domain: number } | any> {
    let data: any = await ax.get(`domains/${domainResponse.id_parent_domain}`)
    if (data.status === 200) {
        data = data.data;
    } else {
        return false;
    }
    if (data.id_parent_domain === 0) {
        return data;
    } else {
        return getTopLeveledDomain(data);
    }
}

/**
 * Builds and puts the acme dns to the dns server
 * @param id domain id
 * @param acmeDns acme dns
 */
function buildAndPutAcmeChallenge(id: number, delay: number, acmeDns: string = '_acme-challenge') {
    ax.get(`dns/${id}`).then((r: AxiosResponse) => {
        let records = r.data.records;
        if (records.other.find((e: { host: string, ttl: number, type: string, value: string }) => e.host === acmeDns)) {
            records.other.find((e: { host: string, ttl: number, type: string, value: string }) => e.host === acmeDns).value = argv.token
            records.other.find((e: { host: string, ttl: number, type: string, value: string }) => e.host === acmeDns).ttl = 300
        } else {
            records.other.push({
                host: acmeDns,
                ttl: 300,
                type: 'TXT',
                value: argv.token
            })
        }
        ax.put(`dns/${id}`, {records}).then((r: AxiosResponse) => {
            console.log(`Successfully put acme challenge(${acmeDns}) to DNS with id: ${r.data.id}`)
            setTimeout(() => {
                process.exit(0);
            },delay*1000);
        }).catch(e => {
            console.error(e);
            process.exit(-1);
        })
    })
}

ax.get(`domains/name/${domainConfig.alias}`).then((r: AxiosResponse) => {
    const domainResponse: { id: number, id_parent_domain: number } | any = r.data;
    if (domainResponse.id_parent_domain === 0) {
        buildAndPutAcmeChallenge(domainResponse.id, argv.delay)
    } else {
        getTopLeveledDomain(domainResponse).then((topLeveledDomain: { id: number, id_parent_domain: number, domain: string }) => {
            const subdomain = domainConfig.alias.replace(topLeveledDomain.domain,'').replace(/\.+$/,'');
            buildAndPutAcmeChallenge(topLeveledDomain.id, argv.delay, `_acme-challenge.${subdomain}`)
        })
    }
}).catch((e) => {
    if (e.response.status === 404) {
        console.error(`Could not find ${domainConfig.alias} on this endpoint!`)
        process.exit(-1);
    }
    console.error(e);
    process.exit(-1);
})