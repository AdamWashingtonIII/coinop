const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("QTR — COINOP Quarter", function () {
  async function deploy() {
    const [treasury, agent, stranger] = await ethers.getSigners();
    const QTR = await ethers.getContractFactory("QTR", treasury);
    const qtr = await QTR.deploy(treasury.address);
    await qtr.waitForDeployment();
    return { qtr, treasury, agent, stranger };
  }
  it("has the decided name, symbol, and 18 decimals", async function () {
    const { qtr, treasury } = await deploy();
    expect(await qtr.name()).to.equal("COINOP Quarter");
    expect(await qtr.symbol()).to.equal("QTR");
    expect(await qtr.decimals()).to.equal(18);
    expect(await qtr.owner()).to.equal(treasury.address);
    expect(await qtr.totalSupply()).to.equal(0);
  });
  it("treasury mints exactly 25 QTR for one paid play", async function () {
    const { qtr, agent } = await deploy();
    await qtr.mint(agent.address, ethers.parseEther("25"));
    expect(await qtr.balanceOf(agent.address)).to.equal(ethers.parseEther("25"));
  });
  it("nobody else can mint", async function () {
    const { qtr, agent, stranger } = await deploy();
    await expect(qtr.connect(stranger).mint(agent.address, 1)).to.be.revertedWithCustomError(qtr, "OwnableUnauthorizedAccount");
  });
  it("owner can appoint a minter who mints within the per-tx cap", async function () {
    const { qtr, treasury, agent, stranger } = await deploy();
    await expect(qtr.connect(stranger).setMinter(stranger.address)).to.be.revertedWithCustomError(qtr, "OwnableUnauthorizedAccount");
    await qtr.setMinter(stranger.address);
    expect(await qtr.minter()).to.equal(stranger.address);
    await qtr.connect(stranger).mint(agent.address, ethers.parseEther("25"));
    expect(await qtr.balanceOf(agent.address)).to.equal(ethers.parseEther("25"));
    await expect(qtr.connect(stranger).mint(agent.address, ethers.parseEther("1001"))).to.be.revertedWith("QTR: minter cap exceeded");
    await qtr.connect(stranger).mint(agent.address, ethers.parseEther("1000")); // exactly at cap is fine
    await qtr.setMinter(ethers.ZeroAddress); // revoke
    await expect(qtr.connect(stranger).mint(agent.address, 1)).to.be.revertedWithCustomError(qtr, "OwnableUnauthorizedAccount");
    expect(await qtr.owner()).to.equal(treasury.address);
  });
  it("agents can transfer QTR freely", async function () {
    const { qtr, agent, stranger } = await deploy();
    await qtr.mint(agent.address, ethers.parseEther("25"));
    await qtr.connect(agent).transfer(stranger.address, ethers.parseEther("5"));
    expect(await qtr.balanceOf(stranger.address)).to.equal(ethers.parseEther("5"));
    expect(await qtr.balanceOf(agent.address)).to.equal(ethers.parseEther("20"));
  });
});
