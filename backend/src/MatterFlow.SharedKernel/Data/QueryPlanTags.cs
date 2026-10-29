namespace MatterFlow.SharedKernel.Data;

/// <summary>
/// Tags a module puts on an EF query (<c>TagWith</c>) to ask the data layer for a plan that does not depend on who compiled it first (issue #938). A statement whose cost depends on
/// how many matters the caller manages (the asset aggregates of the Data Area) is compiled for the first caller's id and reused for everybody else: a plan made for five matters took
/// 3 s for 145. The data layer adds <c>OPTION (USE HINT ('DISABLE_PARAMETER_SNIFFING'))</c> to a command that carries <see cref="StablePlan"/>.
/// </summary>
public static class QueryPlanTags
{
    public const string StablePlan = "mf:stable-plan";
}
