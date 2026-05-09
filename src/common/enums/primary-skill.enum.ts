export enum PrimarySkill {
  Loader = 'Loader',
  Driver = 'Driver',
  Unloader = 'Unloader',
  GeneralLabor = 'General Labor',
  Welder = 'Welder',
}

export enum JobType {
  Loader = 'loader',
  Driver = 'driver',
  Unloader = 'unloader',
  GeneralLabor = 'general_labor',
  Welder = 'welder',
}

export const JOB_TYPE_TO_SKILL: Record<JobType, PrimarySkill> = {
  [JobType.Loader]: PrimarySkill.Loader,
  [JobType.Driver]: PrimarySkill.Driver,
  [JobType.Unloader]: PrimarySkill.Unloader,
  [JobType.GeneralLabor]: PrimarySkill.GeneralLabor,
  [JobType.Welder]: PrimarySkill.Welder,
};
